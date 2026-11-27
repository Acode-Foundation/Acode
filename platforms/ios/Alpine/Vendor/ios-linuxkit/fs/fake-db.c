#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "kernel/errno.h"
#include "debug.h"
#include "misc.h"
#include "fs/fake-db.h"

static void db_check_error(struct fakefs_db *fs) {
    int errcode = sqlite3_errcode(fs->db);
    switch (errcode) {
        case SQLITE_OK:
        case SQLITE_ROW:
        case SQLITE_DONE:
            break;

        default:
            die("sqlite error: %d %#x %s", errcode, sqlite3_extended_errcode(fs->db), sqlite3_errmsg(fs->db));
    }
}

// Retry-aware variants that handle SQLITE_BUSY/SQLITE_LOCKED instead of aborting.
#define DB_RETRY_MAX 50
#define DB_RETRY_DELAY_US 20000  /* 20ms between retries = up to 1s total */

static bool db_exec_retry(struct fakefs_db *fs, sqlite3_stmt *stmt) {
    for (int attempt = 0; attempt < DB_RETRY_MAX; attempt++) {
        int err = sqlite3_step(stmt);
        if (err == SQLITE_ROW || err == SQLITE_DONE || err == SQLITE_OK)
            return err == SQLITE_ROW;
        int errcode = sqlite3_errcode(fs->db);
        if (errcode == SQLITE_BUSY || errcode == SQLITE_LOCKED) {
            sqlite3_reset(stmt);
            usleep(DB_RETRY_DELAY_US);
            continue;
        }
        db_check_error(fs);
        return false;
    }
    printk("WARNING: db_exec_retry exhausted %d attempts, proceeding\n", DB_RETRY_MAX);
    return false;
}

static void db_reset_retry(struct fakefs_db *fs, sqlite3_stmt *stmt) {
    for (int attempt = 0; attempt < DB_RETRY_MAX; attempt++) {
        sqlite3_reset(stmt);
        int errcode = sqlite3_errcode(fs->db);
        if (errcode == SQLITE_OK || errcode == SQLITE_ROW || errcode == SQLITE_DONE)
            return;
        if (errcode == SQLITE_BUSY || errcode == SQLITE_LOCKED) {
            usleep(DB_RETRY_DELAY_US);
            continue;
        }
        db_check_error(fs);
        return;
    }
    printk("WARNING: db_reset_retry exhausted %d attempts\n", DB_RETRY_MAX);
}

// [T-fakefs-db-init-no-die] Init-phase variants that DO NOT abort the whole app
// on a SQLite error. fake_db_init() runs every time a fakefs mount is opened
// (incl. dynamic bind-mounts while the app is running); on iOS 27 betas these
// prepare/step calls were hitting SQLITE_BUSY/LOCKED/IOERR and the old
// db_check_error() → die() path killed the entire process (Abort trap 6 on a
// node-* thread, symbolicated to fake_db_init.cold.1). Instead: retry transient
// lock contention, log the full error, and return the SQLite error code so
// fake_db_init() can fail the mount gracefully (the caller already handles a
// negative return). Returns SQLITE_OK on success.
static int db_log_error(struct fakefs_db *fs, const char *what, const char *sql) {
    int errcode = sqlite3_errcode(fs->db);
    printk("fakefs db init error: %s%s%s — code=%d ext=%#x msg=%s\n",
           what, sql ? " sql=" : "", sql ? sql : "",
           errcode, sqlite3_extended_errcode(fs->db), sqlite3_errmsg(fs->db));
    return errcode;
}

// Prepare a statement, retrying transient BUSY/LOCKED. On terminal failure logs
// and returns the SQLite error code (caller must check); *out is set to the
// statement (NULL on failure).
static int db_prepare_checked(struct fakefs_db *fs, const char *sql, sqlite3_stmt **out) {
    for (int attempt = 0; attempt < DB_RETRY_MAX; attempt++) {
        sqlite3_stmt *stmt = NULL;
        int rc = sqlite3_prepare_v2(fs->db, sql, strlen(sql) + 1, &stmt, NULL);
        if (rc == SQLITE_OK) {
            *out = stmt;
            return SQLITE_OK;
        }
        if (rc == SQLITE_BUSY || rc == SQLITE_LOCKED) {
            if (stmt) sqlite3_finalize(stmt);
            usleep(DB_RETRY_DELAY_US);
            continue;
        }
        if (stmt) sqlite3_finalize(stmt);
        *out = NULL;
        return db_log_error(fs, "prepare", sql);
    }
    *out = NULL;
    printk("fakefs db init: prepare exhausted %d retries: %s\n", DB_RETRY_MAX, sql);
    return SQLITE_BUSY;
}

// Step a statement to completion, retrying transient BUSY/LOCKED. Returns
// SQLITE_DONE/SQLITE_ROW on success, or the error code on terminal failure.
static int db_step_checked(struct fakefs_db *fs, sqlite3_stmt *stmt, const char *sql) {
    for (int attempt = 0; attempt < DB_RETRY_MAX; attempt++) {
        int rc = sqlite3_step(stmt);
        if (rc == SQLITE_DONE || rc == SQLITE_ROW || rc == SQLITE_OK)
            return rc;
        if (rc == SQLITE_BUSY || rc == SQLITE_LOCKED) {
            sqlite3_reset(stmt);
            usleep(DB_RETRY_DELAY_US);
            continue;
        }
        return db_log_error(fs, "step", sql);
    }
    printk("fakefs db init: step exhausted %d retries: %s\n", DB_RETRY_MAX, sql);
    return SQLITE_BUSY;
}

// Convenience: prepare + step + finalize a one-shot statement (pragmas, etc.),
// retrying transient lock contention. Returns SQLITE_OK or the error code.
static int db_exec_oneshot(struct fakefs_db *fs, const char *sql) {
    sqlite3_stmt *stmt = NULL;
    int rc = db_prepare_checked(fs, sql, &stmt);
    if (rc != SQLITE_OK)
        return rc;
    rc = db_step_checked(fs, stmt, sql);
    sqlite3_finalize(stmt);
    return (rc == SQLITE_DONE || rc == SQLITE_ROW || rc == SQLITE_OK) ? SQLITE_OK : rc;
}

bool db_exec(struct fakefs_db *fs, sqlite3_stmt *stmt) {
    return db_exec_retry(fs, stmt);
}
void db_reset(struct fakefs_db *fs, sqlite3_stmt *stmt) {
    db_reset_retry(fs, stmt);
}
void db_exec_reset(struct fakefs_db *fs, sqlite3_stmt *stmt) {
    db_exec(fs, stmt);
    db_reset(fs, stmt);
}

void db_begin_read(struct fakefs_db *fs) {
    sqlite3_mutex_enter(fs->lock);
    db_exec_reset(fs, fs->stmt.begin_deferred);
}
void db_begin_write(struct fakefs_db *fs) {
    sqlite3_mutex_enter(fs->lock);
    db_exec_reset(fs, fs->stmt.begin_immediate);
}
void db_commit(struct fakefs_db *fs) {
    db_exec_reset(fs, fs->stmt.commit);
    sqlite3_mutex_leave(fs->lock);
}
void db_rollback(struct fakefs_db *fs) {
    db_exec_reset(fs, fs->stmt.rollback);
    sqlite3_mutex_leave(fs->lock);
}

static void bind_path(sqlite3_stmt *stmt, int i, const char *path) {
    sqlite3_bind_blob(stmt, i, path, strlen(path), SQLITE_TRANSIENT);
}

inode_t path_get_inode(struct fakefs_db *fs, const char *path) {
    // select inode from paths where path = ?
    bind_path(fs->stmt.path_get_inode, 1, path);
    inode_t inode = 0;
    if (db_exec(fs, fs->stmt.path_get_inode))
        inode = sqlite3_column_int64(fs->stmt.path_get_inode, 0);
    db_reset(fs, fs->stmt.path_get_inode);
    return inode;
}
bool path_read_stat(struct fakefs_db *fs, const char *path, struct ish_stat *stat, inode_t *inode) {
    // select inode, stat from stats natural join paths where path = ?
    bind_path(fs->stmt.path_read_stat, 1, path);
    bool exists = db_exec(fs, fs->stmt.path_read_stat);
    if (exists) {
        if (inode)
            *inode = sqlite3_column_int64(fs->stmt.path_read_stat, 0);
        if (stat)
            *stat = *(struct ish_stat *) sqlite3_column_blob(fs->stmt.path_read_stat, 1);
    }
    db_reset(fs, fs->stmt.path_read_stat);
    return exists;
}
inode_t path_create(struct fakefs_db *fs, const char *path, struct ish_stat *stat) {
    // insert into stats (stat) values (?)
    sqlite3_bind_blob(fs->stmt.path_create_stat, 1, stat, sizeof(*stat), SQLITE_TRANSIENT);
    db_exec_reset(fs, fs->stmt.path_create_stat);
    inode_t inode = sqlite3_last_insert_rowid(fs->db);
    // insert or replace into paths values (?, last_insert_rowid())
    bind_path(fs->stmt.path_create_path, 1, path);
    db_exec_reset(fs, fs->stmt.path_create_path);
    return inode;
}

void inode_read_stat_or_die(struct fakefs_db *fs, inode_t inode, struct ish_stat *stat) {
    if (!inode_read_stat_if_exist(fs, inode, stat))
        die("inode_read_stat(%llu): missing inode", (unsigned long long) inode);
}
bool inode_read_stat_if_exist(struct fakefs_db *fs, inode_t inode, struct ish_stat *stat) {
    // select stat from stats where inode = ?
    sqlite3_bind_int64(fs->stmt.inode_read_stat, 1, inode);
    bool exist = db_exec(fs, fs->stmt.inode_read_stat);
    if (exist)
        *stat = *(struct ish_stat *) sqlite3_column_blob(fs->stmt.inode_read_stat, 0);
    db_reset(fs, fs->stmt.inode_read_stat);
    return exist;
}
void inode_write_stat(struct fakefs_db *fs, inode_t inode, struct ish_stat *stat) {
    // update stats set stat = ? where inode = ?
    sqlite3_bind_blob(fs->stmt.inode_write_stat, 1, stat, sizeof(*stat), SQLITE_TRANSIENT);
    sqlite3_bind_int64(fs->stmt.inode_write_stat, 2, inode);
    db_exec_reset(fs, fs->stmt.inode_write_stat);
}

void path_link(struct fakefs_db *fs, const char *src, const char *dst) {
    inode_t inode = path_get_inode(fs, src);
    if (inode == 0)
        die("fakefs link(%s, %s): nonexistent src path", src, dst);
    // insert or replace into paths (path, inode) values (?, ?)
    bind_path(fs->stmt.path_link, 1, dst);
    sqlite3_bind_int64(fs->stmt.path_link, 2, inode);
    db_exec_reset(fs, fs->stmt.path_link);
}
inode_t path_unlink(struct fakefs_db *fs, const char *path) {
    inode_t inode = path_get_inode(fs, path);
    if (inode == 0)
        return 0;  // Path not in meta.db — already gone or never tracked
    // delete from paths where path = ?
    bind_path(fs->stmt.path_unlink, 1, path);
    db_exec_reset(fs, fs->stmt.path_unlink);
    return inode;
}
void path_rename(struct fakefs_db *fs, const char *src, const char *dst) {
    // update or replace paths set path = change_prefix(path, ? [len(src)], ? [dst])
    //  where (path >= ? [src plus /] and path < [src plus 0]) or path = ? [src]
    // arguments:
    // 1. length of src
    // 2. dst
    // 3. src plus /
    // 4. src plus 0
    // 5. src
    size_t src_len = strlen(src);
    sqlite3_bind_int64(fs->stmt.path_rename, 1, src_len);
    bind_path(fs->stmt.path_rename, 2, dst);
    char src_extra[src_len + 1];
    memcpy(src_extra, src, src_len);
    src_extra[src_len] = '/';
    sqlite3_bind_blob(fs->stmt.path_rename, 3, src_extra, src_len + 1, SQLITE_TRANSIENT);
    src_extra[src_len] = '0';
    sqlite3_bind_blob(fs->stmt.path_rename, 4, src_extra, src_len + 1, SQLITE_TRANSIENT);
    sqlite3_bind_blob(fs->stmt.path_rename, 5, src_extra, src_len, SQLITE_TRANSIENT);
    db_exec_reset(fs, fs->stmt.path_rename);
}

#if DEBUG_sql
static int trace_callback(unsigned UNUSED(why), void *UNUSED(fuck), void *stmt, void *_sql) {
    char *sql = _sql;
    printk("%d sql trace: %s %s\n", current ? current->pid : -1, sqlite3_expanded_sql(stmt), sql[0] == '-' ? sql : "");
    return 0;
}
#endif

static void sqlite_func_change_prefix(sqlite3_context *context, int argc, sqlite3_value **args) {
    assert(argc == 3);
    const void *in_blob = sqlite3_value_blob(args[0]);
    size_t in_size = sqlite3_value_bytes(args[0]);
    size_t start = sqlite3_value_int64(args[1]);
    const void *replacement = sqlite3_value_blob(args[2]);
    size_t replacement_size = sqlite3_value_bytes(args[2]);
    size_t out_size = in_size - start + replacement_size;
    char *out_blob = sqlite3_malloc(out_size);
    memcpy(out_blob, replacement, replacement_size);
    memcpy(out_blob + replacement_size, in_blob + start, in_size - start);
    sqlite3_result_blob(context, out_blob, out_size, sqlite3_free);
}

extern int fakefs_rebuild(struct fakefs_db *fs, int root_fd);
extern int fakefs_migrate(struct fakefs_db *fs, int root_fd);

int fake_db_init(struct fakefs_db *fs, const char *db_path, int root_fd) {
    int err = sqlite3_open_v2(db_path, &fs->db, SQLITE_OPEN_READWRITE, NULL);
    if (err != SQLITE_OK) {
        printk("error opening database: %s\n", sqlite3_errmsg(fs->db));
        sqlite3_close(fs->db);
        return _EINVAL;
    }
    sqlite3_busy_timeout(fs->db, 5000);
    sqlite3_create_function(fs->db, "change_prefix", 3, SQLITE_UTF8 | SQLITE_DETERMINISTIC, NULL, sqlite_func_change_prefix, NULL, NULL);

    // [T-fakefs-db-init-no-die] Every prepare/step below now fails the mount
    // (return _EIO) instead of die()-ing the whole app on a SQLite error. The
    // caller (fakefs mount) already handles a negative return gracefully.
    if (db_exec_oneshot(fs, "pragma journal_mode=wal") != SQLITE_OK) goto init_fail;
    if (db_exec_oneshot(fs, "pragma foreign_keys=true") != SQLITE_OK) goto init_fail;

    // N18: Apple-friendly sqlite tuning. The fakefs db is read-mostly
    // during normal use (writes happen for chmod / chown / mknod / new
    // files). N17 signpost data showed 78K db_exec calls totaling
    // 122ms = 8% of npm --version user CPU. Three knobs help on macOS:
    //
    //  - PRAGMA mmap_size: lets sqlite read pages directly through
    //    mmap instead of read() syscalls. The OS's unified buffer
    //    cache then serves repeated reads at memcpy speed.
    //  - PRAGMA cache_size (negative => KB of in-process page cache):
    //    sqlite default is 2 MB; bump to 64 MB so the working set fits.
    //  - PRAGMA synchronous=NORMAL: WAL with NORMAL is durable across
    //    process crashes (like FULL) but skips an fsync per commit,
    //    cheap when fakefs writes are infrequent.
    //  - PRAGMA temp_store=MEMORY: keeps sort/temp tables off disk.
    static const char *tuning[] = {
        "pragma mmap_size=268435456",   // 256 MB
        "pragma cache_size=-65536",     // 64 MB in-process page cache
        "pragma synchronous=NORMAL",
        "pragma temp_store=MEMORY",
    };
    for (size_t ti = 0; ti < sizeof(tuning)/sizeof(tuning[0]); ti++) {
        // Tuning pragmas are best-effort: a failure here only loses a perf knob,
        // not correctness, so log and continue rather than fail the mount.
        if (db_exec_oneshot(fs, tuning[ti]) != SQLITE_OK)
            printk("fakefs db init: tuning pragma failed (continuing): %s\n", tuning[ti]);
    }

#if DEBUG_sql
    sqlite3_trace_v2(mount->db, SQLITE_TRACE_STMT, trace_callback, NULL);
#endif

    err = fakefs_migrate(fs, root_fd);
    if (err < 0)
        return err;

    // after the filesystem is compressed, transmitted, and uncompressed, the
    // inode numbers will be different. to detect this, the inode of the
    // database file is stored inside the database and compared with the actual
    // database file inode, and if they're different we rebuild the database.
    struct stat statbuf;
    if (stat(db_path, &statbuf) < 0) ERRNO_DIE("stat database");
    ino_t db_inode = statbuf.st_ino;
    sqlite3_stmt *statement = NULL;
    if (db_prepare_checked(fs, "select db_inode from meta", &statement) != SQLITE_OK) goto init_fail;
    if (db_step_checked(fs, statement, "select db_inode from meta") == SQLITE_ROW) {
        if ((uint64_t) sqlite3_column_int64(statement, 0) != db_inode) {
            sqlite3_finalize(statement);
            statement = NULL;
            int err = fakefs_rebuild(fs, root_fd);
            if (err < 0) {
                return err;
            }
        }
    }
    if (statement != NULL)
        sqlite3_finalize(statement);

    // save current inode
    if (db_prepare_checked(fs, "update meta set db_inode = ?", &statement) != SQLITE_OK) goto init_fail;
    sqlite3_bind_int64(statement, 1, (int64_t) db_inode);
    int meta_rc = db_step_checked(fs, statement, "update meta set db_inode = ?");
    if (meta_rc != SQLITE_DONE && meta_rc != SQLITE_ROW && meta_rc != SQLITE_OK) {
        sqlite3_finalize(statement);
        goto init_fail;
    }
    sqlite3_finalize(statement);

    // delete orphaned stats
    if (db_exec_oneshot(fs, "delete from stats where not exists (select 1 from paths where inode = stats.inode)") != SQLITE_OK)
        goto init_fail;

    fs->lock = sqlite3_mutex_alloc(SQLITE_MUTEX_FAST);
    // [T-fakefs-db-init-no-die] Each cached statement must prepare successfully;
    // a NULL would crash later at runtime. On any failure, fail the mount.
#define PREPARE_OR_FAIL(field, sql) \
    if (db_prepare_checked(fs, (sql), &fs->stmt.field) != SQLITE_OK) goto init_fail
    PREPARE_OR_FAIL(begin_deferred, "begin deferred");
    PREPARE_OR_FAIL(begin_immediate, "begin immediate");
    PREPARE_OR_FAIL(commit, "commit");
    PREPARE_OR_FAIL(rollback, "rollback");
    PREPARE_OR_FAIL(path_get_inode, "select inode from paths where path = ?");
    PREPARE_OR_FAIL(path_read_stat, "select inode, stat from stats natural join paths where path = ?");
    PREPARE_OR_FAIL(path_create_stat, "insert into stats (stat) values (?)");
    PREPARE_OR_FAIL(path_create_path, "insert or replace into paths values (?, last_insert_rowid())");
    PREPARE_OR_FAIL(inode_read_stat, "select stat from stats where inode = ?");
    PREPARE_OR_FAIL(inode_write_stat, "update stats set stat = ? where inode = ?");
    PREPARE_OR_FAIL(path_link, "insert or replace into paths (path, inode) values (?, ?)");
    PREPARE_OR_FAIL(path_unlink, "delete from paths where path = ?");
    PREPARE_OR_FAIL(path_rename, "update or replace paths set path = change_prefix(path, ?, ?) "
            "where (path >= ? and path < ?) or path = ?");
    PREPARE_OR_FAIL(path_from_inode, "select path from paths where inode = ?");
    PREPARE_OR_FAIL(try_cleanup_inode, "delete from stats where inode = ? and not exists (select 1 from paths where inode = stats.inode)");
#undef PREPARE_OR_FAIL
    return 0;

init_fail:
    // [T-fakefs-db-init-no-die] A SQLite error during init no longer aborts the
    // whole app. Close the half-open db and return an error so the fakefs mount
    // fails gracefully (the caller handles a negative return).
    printk("fakefs db init: FAILED for %s — mount aborted (app kept alive)\n", db_path);
    if (fs->db) {
        sqlite3_close(fs->db);
        fs->db = NULL;
    }
    return _EIO;
}

int fake_db_deinit(struct fakefs_db *fs) {
    if (fs->db) {
        sqlite3_finalize(fs->stmt.begin_deferred);
        sqlite3_finalize(fs->stmt.begin_immediate);
        sqlite3_finalize(fs->stmt.commit);
        sqlite3_finalize(fs->stmt.rollback);
        sqlite3_finalize(fs->stmt.path_get_inode);
        sqlite3_finalize(fs->stmt.path_read_stat);
        sqlite3_finalize(fs->stmt.path_create_stat);
        sqlite3_finalize(fs->stmt.path_create_path);
        sqlite3_finalize(fs->stmt.inode_read_stat);
        sqlite3_finalize(fs->stmt.inode_write_stat);
        sqlite3_finalize(fs->stmt.path_link);
        sqlite3_finalize(fs->stmt.path_unlink);
        sqlite3_finalize(fs->stmt.path_rename);
        sqlite3_finalize(fs->stmt.path_from_inode);
        sqlite3_finalize(fs->stmt.try_cleanup_inode);
        return sqlite3_close(fs->db);
    }
    return SQLITE_OK;
}
