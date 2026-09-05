#!/bin/bash

# ============================================================
# Acode Ubuntu Rootfs launcher
# ============================================================

export PATH="/bin:/sbin:/usr/bin:/usr/sbin:/usr/share/bin:/usr/share/sbin:/usr/local/bin:/usr/local/sbin:/system/bin:/system/xbin:$PREFIX/local/bin"
export HOME="/public"
export TERM="xterm-256color"
export PS1='\[\e[38;5;46m\]\u\[\e[39m\]@localhost \[\e[39m\]\w \[\e[0m\]\$ '

INSTALLING=false
FAILSAFE=false

# ============================================================
# Parse arguments
# ============================================================

while [ "$#" -gt 0 ]; do
    case "$1" in
        --installing)
            INSTALLING=true
            shift
            ;;
        --failsafe)
            FAILSAFE=true
            shift
            ;;
        --)
            shift
            break
            ;;
        *)
            break
            ;;
    esac
done

# ============================================================
# Execute supplied command directly (VERY IMPORTANT)
# ============================================================

if [ "$INSTALLING" != true ] && [ "$#" -gt 0 ]; then
    exec "$@"
fi

# ============================================================
# One-time rootfs installation
#
# IMPORTANT:
# Normal launches should NEVER run apt.
# ============================================================

if [ "$INSTALLING" = true ]; then
    export DEBIAN_FRONTEND=noninteractive

    echo "[*] Configuring rootfs..."

    # --------------------------------------------------------
    # Configure timezone before tzdata is installed.
    # --------------------------------------------------------

    if [ -n "$ANDROID_TZ" ] &&
       [ -f "/usr/share/zoneinfo/$ANDROID_TZ" ]; then

        mkdir -p /etc

        ln -sf \
            "/usr/share/zoneinfo/$ANDROID_TZ" \
            /etc/localtime

        echo "$ANDROID_TZ" > /etc/timezone

        echo "[+] Timezone: $ANDROID_TZ"
    else
        ln -sf /usr/share/zoneinfo/UTC /etc/localtime
        echo "Etc/UTC" > /etc/timezone

        echo "[+] Timezone: UTC"
    fi

    # --------------------------------------------------------
    # Rootfs filesystem setup
    # --------------------------------------------------------

    mkdir -p /linkerconfig

    if [ ! -f /linkerconfig/ld.config.txt ]; then
        touch /linkerconfig/ld.config.txt
    fi

    mkdir -p "$HOME"
    mkdir -p "$PREFIX/ubuntu/usr/local/bin"

    # --------------------------------------------------------
    # Acode MOTD
    # --------------------------------------------------------

    if [ ! -e "$PREFIX/ubuntu/etc/acode_motd" ]; then
        cat > "$PREFIX/ubuntu/etc/acode_motd" <<'EOF'
Welcome to Ubuntu Linux in Acode!

Working with packages:

 - Search:    apt search <query>
 - Install:   apt install <package>
 - Uninstall: apt remove <package>
 - Upgrade:   apt update && apt upgrade
EOF
    fi

    # --------------------------------------------------------
    # Acode CLI
    # --------------------------------------------------------

    if [ ! -e "$PREFIX/ubuntu/usr/local/bin/acode" ]; then
        cat > "$PREFIX/ubuntu/usr/local/bin/acode" <<'ACODE_CLI'
#!/bin/bash

usage() {
    echo "Usage: acode [file/folder...]"
    echo
    echo "Open files or folders in Acode editor."
    echo
    echo "Examples:"
    echo "  acode file.txt"
    echo "  acode ."
    echo "  acode ~/project"
    echo "  acode -h, --help"
}

get_abs_path() {
    local path="$1"
    local abs_path=""

    if command -v realpath >/dev/null 2>&1; then
        abs_path=$(realpath -- "$path" 2>/dev/null)
    fi

    if [ -z "$abs_path" ]; then
        if [ -d "$path" ]; then
            abs_path=$(cd -- "$path" 2>/dev/null && pwd -P)

        elif [ -e "$path" ]; then
            local dir_name
            local file_name

            dir_name=$(dirname -- "$path")
            file_name=$(basename -- "$path")

            abs_path="$(
                cd -- "$dir_name" 2>/dev/null &&
                pwd -P
            )/$file_name"

        elif [[ "$path" == /* ]]; then
            abs_path="$path"

        else
            abs_path="$PWD/$path"
        fi
    fi

    echo "$abs_path"
}

open_in_acode() {
    local path
    local type="file"

    path=$(get_abs_path "$1")

    if [ -d "$path" ]; then
        type="folder"
    fi

    printf '\e]7777;open;%s;%s\a' "$type" "$path"
}

if [ "$#" -eq 0 ]; then
    open_in_acode "."
    exit 0
fi

for arg in "$@"; do
    case "$arg" in
        -h|--help)
            usage
            exit 0
            ;;

        *)
            if [ -e "$arg" ]; then
                open_in_acode "$arg"
            else
                echo "Error: '$arg' does not exist" >&2
                exit 1
            fi
            ;;
    esac
done
ACODE_CLI

        chmod +x "$PREFIX/ubuntu/usr/local/bin/acode"
    fi

    # --------------------------------------------------------
    # Create initrc
    # --------------------------------------------------------

    if [ ! -e "$PREFIX/ubuntu/initrc" ]; then
        cat > "$PREFIX/ubuntu/initrc" <<'EOF'
# ============================================================
# Acode Ubuntu shell initialization
# ============================================================

# Load system profile
if [ -f /etc/profile ]; then
    source /etc/profile
fi

export PATH="$PATH:/bin:/sbin:/usr/bin:/usr/sbin:/usr/share/bin:/usr/share/sbin:/usr/local/bin:/usr/local/sbin"
export HOME="/public"
export TERM="xterm-256color"
export SHELL="/bin/bash"

# Allow pip to install packages into the system environment.
export PIP_BREAK_SYSTEM_PACKAGES=1

# ============================================================
# Shorten current path
# ~/project/src/components
# becomes:
# ~/p/s/components
# ============================================================

_shorten_path() {
    local path="$PWD"

    if [[ "$HOME" != "/" && "$path" == "$HOME" ]]; then
        echo "~"
        return
    fi

    if [[ "$HOME" != "/" && "$path" == "$HOME/"* ]]; then
        path="~${path#$HOME}"
    fi

    [[ "$path" == "~" ]] && echo "~" && return

    local parts
    local result=""
    local len

    IFS='/' read -ra parts <<< "$path"

    len=${#parts[@]}

    for ((i=0; i<len; i++)); do
        [[ -z "${parts[i]}" ]] && continue

        if [[ "$i" -lt $((len - 1)) ]]; then
            result+="${parts[i]:0:1}/"
        else
            result+="${parts[i]}"
        fi
    done

    if [[ "$path" == /* ]]; then
        echo "/$result"
    else
        echo "$result"
    fi
}

# ============================================================
# Prompt
# ============================================================

PROMPT_COMMAND='_PS1_PATH=$(_shorten_path); _PS1_EXIT=$?'

PS1='\[\033[1;32m\]\u\[\033[0m\]@localhost \[\033[1;34m\]$_PS1_PATH\[\033[0m\] \[\033[0m\]\$ '

# ============================================================
# MOTD
# ============================================================

if [ -s /etc/acode_motd ]; then
    cat /etc/acode_motd
fi

# ============================================================
# Binary execution warning
# ============================================================

check_binary_execution() {
    local cmd="$1"
    local cmd_path=""

    [[ -z "$cmd" ]] && return

    if [[ "$cmd" == */* ]]; then
        cmd_path="$(realpath "$cmd" 2>/dev/null)"
    else
        cmd_path="$(command -v "$cmd" 2>/dev/null)"

        if [[ -n "$cmd_path" ]]; then
            cmd_path="$(realpath "$cmd_path" 2>/dev/null)"
        fi
    fi

    [[ -z "$cmd_path" ]] && return
    [[ ! -f "$cmd_path" ]] && return

    if [[ "$cmd_path" == /storage/* ]] ||
       [[ "$cmd_path" == /sdcard/* ]]; then

        echo -e "\e[1;31m[!] ATTENTION REQUIRED\e[0m

\e[1;31mThe binary is located in:\e[0m
  \e[36m$cmd_path\e[0m

\e[1;31mBinaries cannot be executed reliably from /sdcard or /storage.\e[0m

These locations are backed by Android's external storage layer
and do not support normal Linux executable permissions.

Move your project or binary to a directory under:

  \e[1;32m/home/\e[0m

Example:

  \e[1;32mmv myproject ~/myproject\e[0m
  \e[1;32mcd ~/myproject\e[0m

Then run the binary again.
" >&2
    fi
}

_acode_preexec() {
    [[ "$BASH_COMMAND" == trap* ]] && return

    local cmd="${BASH_COMMAND%% *}"

    check_binary_execution "$cmd"
}

# Preserve an existing DEBUG trap.
__acode_existing_debug_trap="$(trap -p DEBUG 2>/dev/null)"

if [[ -n "$__acode_existing_debug_trap" ]]; then
    __acode_existing_cmd="$(
        printf '%s' "$__acode_existing_debug_trap" |
        sed -E "s/.*'((.*))'.*/\1/"
    )"
else
    __acode_existing_cmd=""
fi

if [[ "$__acode_existing_cmd" != *"_acode_preexec"* ]]; then
    if [[ -n "$__acode_existing_cmd" ]]; then
        trap "$__acode_existing_cmd; _acode_preexec" DEBUG
    else
        trap '_acode_preexec' DEBUG
    fi
fi

unset __acode_existing_debug_trap
unset __acode_existing_cmd

# ============================================================
# Command-not-found handler
# ============================================================

command_not_found_handle() {
    local cmd="$1"
    local pkg=""

    pkg="$(
        apt-cache search "^${cmd}$" 2>/dev/null |
        awk '{print $1}' |
        head -n 1
    )"

    if [ -n "$pkg" ]; then
        echo -e "The program '$cmd' is not installed.\nInstall it with:\n \e[1;32mapt install $pkg\e[0m" >&2
    else
        echo "The program '$cmd' is not installed and no package provides it." >&2
    fi

    return 127
}

# Termux-compatible behaviour
alias clear='reset'

# ============================================================
# User configuration
# ============================================================

if [ -f /etc/bash/bashrc ]; then
    source /etc/bash/bashrc
fi

if [ -f "$HOME/.bashrc" ]; then
    source "$HOME/.bashrc"
fi
EOF
    fi

    chmod +x "$PREFIX/ubuntu/initrc"

    # --------------------------------------------------------
    # Mark rootfs as configured
    # --------------------------------------------------------

    mkdir -p "$PREFIX/.configured"

    touch "$PREFIX/.configured/rootfs"

    echo "[+] Rootfs configuration complete."
    exit 0
fi

# ============================================================

echo "$$" > "$PREFIX/pid"

chmod +x "$PREFIX/axs"

if [ "$FAILSAFE" = true ]; then
    exit 0
fi

exec "$PREFIX/axs" -c "exec bash --rcfile /initrc -i"
