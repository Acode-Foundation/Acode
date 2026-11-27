#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <pty.h>
#include <rfb/keysym.h>
#include <rfb/rfb.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#include <SDL2/SDL.h>
#include <SDL2/SDL_ttf.h>
#include <vterm.h>

#define DEFAULT_COLS 120
#define DEFAULT_ROWS 36
#define DEFAULT_FONT_SIZE 18
#define DEFAULT_VNC_PORT 5907
#define MAX_ARGV 128

typedef struct Harness {
    int cols;
    int rows;
    int cell_w;
    int cell_h;
    int width;
    int height;
    int pty_fd;
    pid_t child_pid;
    bool dirty;
    bool running;
    bool headless;
    SDL_Window *window;
    SDL_Surface *window_surface;
    SDL_Surface *frame;
    TTF_Font *font;
    VTerm *vt;
    VTermScreen *screen;
    rfbScreenInfoPtr vnc;
    int cursor_visible;
} Harness;

static void die(const char *msg) {
    perror(msg);
    exit(1);
}

static void set_nonblock(int fd) {
    int flags = fcntl(fd, F_GETFL, 0);
    if (flags < 0)
        die("fcntl(F_GETFL)");
    if (fcntl(fd, F_SETFL, flags | O_NONBLOCK) < 0)
        die("fcntl(F_SETFL)");
}

static void pty_write_all(Harness *h, const char *buf, size_t len) {
    while (len > 0) {
        ssize_t n = write(h->pty_fd, buf, len);
        if (n < 0) {
            if (errno == EINTR)
                continue;
            if (errno == EAGAIN || errno == EWOULDBLOCK)
                return;
            return;
        }
        buf += n;
        len -= (size_t)n;
    }
}

static void pty_send(Harness *h, const char *s) {
    pty_write_all(h, s, strlen(s));
}

static void send_key_sequence(Harness *h, SDL_Keycode key, bool ctrl, bool alt, bool shift) {
    (void)alt;
    (void)shift;
    if (ctrl && key >= SDLK_a && key <= SDLK_z) {
        char c = (char)(key - SDLK_a + 1);
        pty_write_all(h, &c, 1);
        return;
    }
    switch (key) {
        case SDLK_RETURN: pty_send(h, "\r"); break;
        case SDLK_BACKSPACE: { char c = 0x7f; pty_write_all(h, &c, 1); break; }
        case SDLK_TAB: pty_send(h, "\t"); break;
        case SDLK_ESCAPE: { char c = 0x1b; pty_write_all(h, &c, 1); break; }
        case SDLK_UP: pty_send(h, "\x1b[A"); break;
        case SDLK_DOWN: pty_send(h, "\x1b[B"); break;
        case SDLK_RIGHT: pty_send(h, "\x1b[C"); break;
        case SDLK_LEFT: pty_send(h, "\x1b[D"); break;
        case SDLK_HOME: pty_send(h, "\x1b[H"); break;
        case SDLK_END: pty_send(h, "\x1b[F"); break;
        case SDLK_DELETE: pty_send(h, "\x1b[3~"); break;
        case SDLK_PAGEUP: pty_send(h, "\x1b[5~"); break;
        case SDLK_PAGEDOWN: pty_send(h, "\x1b[6~"); break;
        default: break;
    }
}

static void send_vnc_keysym(Harness *h, rfbKeySym sym, bool down) {
    if (!down)
        return;
    if (sym >= 0x20 && sym <= 0x7e) {
        char c = (char)sym;
        pty_write_all(h, &c, 1);
        return;
    }
    switch (sym) {
        case XK_Return: pty_send(h, "\r"); break;
        case XK_BackSpace: { char c = 0x7f; pty_write_all(h, &c, 1); break; }
        case XK_Tab: pty_send(h, "\t"); break;
        case XK_Escape: { char c = 0x1b; pty_write_all(h, &c, 1); break; }
        case XK_Up: pty_send(h, "\x1b[A"); break;
        case XK_Down: pty_send(h, "\x1b[B"); break;
        case XK_Right: pty_send(h, "\x1b[C"); break;
        case XK_Left: pty_send(h, "\x1b[D"); break;
        case XK_Home: pty_send(h, "\x1b[H"); break;
        case XK_End: pty_send(h, "\x1b[F"); break;
        case XK_Delete: pty_send(h, "\x1b[3~"); break;
        case XK_Page_Up: pty_send(h, "\x1b[5~"); break;
        case XK_Page_Down: pty_send(h, "\x1b[6~"); break;
        default: break;
    }
}

static SDL_Color color_from_vterm(Harness *h, VTermColor in) {
    vterm_screen_convert_color_to_rgb(h->screen, &in);
    SDL_Color c = { in.rgb.red, in.rgb.green, in.rgb.blue, 255 };
    return c;
}

static void fill_rect32(SDL_Surface *surface, int x, int y, int w, int h, SDL_Color c) {
    SDL_Rect rect = {x, y, w, h};
    Uint32 pixel = SDL_MapRGBA(surface->format, c.r, c.g, c.b, 255);
    SDL_FillRect(surface, &rect, pixel);
}

static void draw_utf8_glyph(Harness *h, uint32_t cp, SDL_Color fg, SDL_Color bg, int x, int y) {
    fill_rect32(h->frame, x, y, h->cell_w, h->cell_h, bg);
    if (cp == 0 || cp == ' ')
        return;

    SDL_Surface *glyph = TTF_RenderGlyph32_Blended(h->font, cp, fg);
    if (glyph == NULL)
        glyph = TTF_RenderGlyph32_Blended(h->font, '?', fg);
    if (glyph == NULL)
        return;

    SDL_Rect dst = {
        .x = x,
        .y = y + (h->cell_h - glyph->h) / 2,
        .w = glyph->w,
        .h = glyph->h,
    };
    SDL_BlitSurface(glyph, NULL, h->frame, &dst);
    SDL_FreeSurface(glyph);
}

static void redraw(Harness *h) {
    if (!h->dirty)
        return;

    VTermPos cursor = {0, 0};
    vterm_state_get_cursorpos(vterm_obtain_state(h->vt), &cursor);

    for (int row = 0; row < h->rows; row++) {
        for (int col = 0; col < h->cols; col++) {
            VTermScreenCell cell;
            VTermPos pos = {.row = row, .col = col};
            if (!vterm_screen_get_cell(h->screen, pos, &cell))
                memset(&cell, 0, sizeof(cell));
            SDL_Color fg = color_from_vterm(h, cell.fg);
            SDL_Color bg = color_from_vterm(h, cell.bg);
            if (cell.attrs.reverse) {
                SDL_Color tmp = fg; fg = bg; bg = tmp;
            }
            if (h->cursor_visible && cursor.row == row && cursor.col == col) {
                SDL_Color tmp = fg; fg = bg; bg = tmp;
            }
            uint32_t cp = cell.chars[0];
            draw_utf8_glyph(h, cp, fg, bg, col * h->cell_w, row * h->cell_h);
        }
    }

    if (!h->headless && h->window_surface) {
        SDL_BlitSurface(h->frame, NULL, h->window_surface, NULL);
        SDL_UpdateWindowSurface(h->window);
    }
    if (h->vnc) {
        rfbMarkRectAsModified(h->vnc, 0, 0, h->width, h->height);
    }
    h->dirty = false;
}

static int screen_damage(VTermRect rect, void *user) {
    (void)rect;
    Harness *h = user;
    h->dirty = true;
    return 1;
}

static int screen_moverect(VTermRect dest, VTermRect src, void *user) {
    (void)dest; (void)src;
    Harness *h = user;
    h->dirty = true;
    return 1;
}

static int screen_movecursor(VTermPos pos, VTermPos oldpos, int visible, void *user) {
    (void)pos; (void)oldpos; (void)visible;
    Harness *h = user;
    h->dirty = true;
    return 1;
}

static int screen_settermprop(VTermProp prop, VTermValue *val, void *user) {
    Harness *h = user;
    if (prop == VTERM_PROP_CURSORVISIBLE)
        h->cursor_visible = val->boolean;
    h->dirty = true;
    return 1;
}

static int screen_bell(void *user) {
    Harness *h = user;
    h->dirty = true;
    return 1;
}

static int screen_resize(int rows, int cols, void *user) {
    Harness *h = user;
    if (rows == h->rows && cols == h->cols)
        return 1;
    h->rows = rows;
    h->cols = cols;
    h->width = cols * h->cell_w;
    h->height = rows * h->cell_h;
    h->dirty = true;
    return 1;
}

static void vnc_keyboard(rfbBool down, rfbKeySym key, rfbClientPtr cl) {
    Harness *h = cl->screen->screenData;
    send_vnc_keysym(h, key, down);
}

static void vnc_ptr(int buttonMask, int x, int y, rfbClientPtr cl) {
    (void)buttonMask; (void)x; (void)y; (void)cl;
}

static void install_winsize(Harness *h) {
    struct winsize ws = {
        .ws_col = (unsigned short)h->cols,
        .ws_row = (unsigned short)h->rows,
        .ws_xpixel = (unsigned short)h->width,
        .ws_ypixel = (unsigned short)h->height,
    };
    ioctl(h->pty_fd, TIOCSWINSZ, &ws);
}

static void spawn_ish(Harness *h, const char *ish_bin, const char *rootfs, char **child_argv) {
    struct winsize ws = {
        .ws_col = (unsigned short)h->cols,
        .ws_row = (unsigned short)h->rows,
        .ws_xpixel = (unsigned short)h->width,
        .ws_ypixel = (unsigned short)h->height,
    };
    pid_t pid = forkpty(&h->pty_fd, NULL, NULL, &ws);
    if (pid < 0)
        die("forkpty");
    if (pid == 0) {
        setenv("TERM", "xterm-256color", 1);
        char *argv[MAX_ARGV];
        int i = 0;
        argv[i++] = (char *)ish_bin;
        argv[i++] = "-f";
        argv[i++] = (char *)rootfs;
        for (int j = 0; child_argv[j] && i < MAX_ARGV - 1; j++)
            argv[i++] = child_argv[j];
        argv[i] = NULL;
        execvp(ish_bin, argv);
        perror("execvp");
        _exit(127);
    }
    h->child_pid = pid;
    set_nonblock(h->pty_fd);
}

static void usage(const char *argv0) {
    fprintf(stderr,
        "usage: %s [--headless] [--ish PATH] [--rootfs PATH] [--font PATH] [--font-size N] [--cols N] [--rows N] [--vnc-port N] [--] [guest cmd ...]\n",
        argv0);
}

int main(int argc, char **argv) {
    Harness h = {
        .cols = DEFAULT_COLS,
        .rows = DEFAULT_ROWS,
        .running = true,
        .dirty = true,
        .headless = false,
        .cursor_visible = 1,
    };

    const char *ish_bin = "./build-clang/ish";
    const char *rootfs = "./rootfs/alpine";
    const char *font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf";
    int font_size = DEFAULT_FONT_SIZE;
    int vnc_port = DEFAULT_VNC_PORT;

    int argi = 1;
    while (argi < argc) {
        if (strcmp(argv[argi], "--") == 0) {
            argi++;
            break;
        } else if (strcmp(argv[argi], "--headless") == 0) {
            h.headless = true;
            argi++;
        } else if (strcmp(argv[argi], "--ish") == 0 && argi + 1 < argc) {
            ish_bin = argv[argi + 1];
            argi += 2;
        } else if (strcmp(argv[argi], "--rootfs") == 0 && argi + 1 < argc) {
            rootfs = argv[argi + 1];
            argi += 2;
        } else if (strcmp(argv[argi], "--font") == 0 && argi + 1 < argc) {
            font_path = argv[argi + 1];
            argi += 2;
        } else if (strcmp(argv[argi], "--font-size") == 0 && argi + 1 < argc) {
            font_size = atoi(argv[argi + 1]);
            argi += 2;
        } else if (strcmp(argv[argi], "--cols") == 0 && argi + 1 < argc) {
            h.cols = atoi(argv[argi + 1]);
            argi += 2;
        } else if (strcmp(argv[argi], "--rows") == 0 && argi + 1 < argc) {
            h.rows = atoi(argv[argi + 1]);
            argi += 2;
        } else if (strcmp(argv[argi], "--vnc-port") == 0 && argi + 1 < argc) {
            vnc_port = atoi(argv[argi + 1]);
            argi += 2;
        } else {
            break;
        }
    }

    char *default_cmd[] = {"/bin/sh", NULL};
    char **child_argv = (argi < argc) ? &argv[argi] : default_cmd;

    if (TTF_Init() < 0) {
        fprintf(stderr, "TTF_Init: %s\n", TTF_GetError());
        return 1;
    }
    if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS) < 0) {
        fprintf(stderr, "SDL_Init: %s\n", SDL_GetError());
        return 1;
    }

    h.font = TTF_OpenFont(font_path, font_size);
    if (!h.font) {
        fprintf(stderr, "TTF_OpenFont(%s): %s\n", font_path, TTF_GetError());
        return 1;
    }
    if (TTF_SizeUTF8(h.font, "M", &h.cell_w, &h.cell_h) < 0) {
        fprintf(stderr, "TTF_SizeUTF8: %s\n", TTF_GetError());
        return 1;
    }
    h.cell_w += 1;
    h.width = h.cols * h.cell_w;
    h.height = h.rows * h.cell_h;

    h.frame = SDL_CreateRGBSurfaceWithFormat(0, h.width, h.height, 32, SDL_PIXELFORMAT_ARGB8888);
    if (!h.frame) {
        fprintf(stderr, "SDL_CreateRGBSurfaceWithFormat: %s\n", SDL_GetError());
        return 1;
    }

    if (!h.headless) {
        h.window = SDL_CreateWindow("iSH SDL/VNC harness", SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED,
            h.width, h.height, 0);
        if (!h.window) {
            fprintf(stderr, "SDL_CreateWindow: %s\n", SDL_GetError());
            return 1;
        }
        h.window_surface = SDL_GetWindowSurface(h.window);
    }

    h.vt = vterm_new(h.rows, h.cols);
    if (!h.vt)
        die("vterm_new");
    h.screen = vterm_obtain_screen(h.vt);
    VTermScreenCallbacks callbacks = {
        .damage = screen_damage,
        .moverect = screen_moverect,
        .movecursor = screen_movecursor,
        .settermprop = screen_settermprop,
        .bell = screen_bell,
        .resize = screen_resize,
    };
    vterm_screen_set_callbacks(h.screen, &callbacks, &h);
    vterm_screen_set_damage_merge(h.screen, VTERM_DAMAGE_SCREEN);
    vterm_screen_reset(h.screen, 1);

    int argc_vnc = 3;
    char *argv_vnc[] = { (char *)"ish-sdl-vnc", (char *)"-rfbport", NULL, NULL };
    char portbuf[32];
    snprintf(portbuf, sizeof(portbuf), "%d", vnc_port);
    argv_vnc[2] = portbuf;
    h.vnc = rfbGetScreen(&argc_vnc, argv_vnc, h.width, h.height, 8, 3, 4);
    if (!h.vnc)
        die("rfbGetScreen");
    h.vnc->frameBuffer = (char *)h.frame->pixels;
    h.vnc->desktopName = "iSH SDL/VNC harness";
    h.vnc->port = vnc_port;
    h.vnc->ipv6port = vnc_port;
    h.vnc->kbdAddEvent = vnc_keyboard;
    h.vnc->ptrAddEvent = vnc_ptr;
    h.vnc->screenData = &h;
    rfbInitServer(h.vnc);

    spawn_ish(&h, ish_bin, rootfs, child_argv);
    install_winsize(&h);
    SDL_StartTextInput();

    fprintf(stderr, "Harness ready: SDL=%s VNC=:%d child_pid=%d\n",
        h.headless ? "headless" : "window", vnc_port, (int)h.child_pid);

    struct pollfd pfd = {.fd = h.pty_fd, .events = POLLIN};
    while (h.running) {
        char buf[8192];
        ssize_t n = read(h.pty_fd, buf, sizeof(buf));
        if (n > 0) {
            vterm_input_write(h.vt, buf, (size_t)n);
            vterm_screen_flush_damage(h.screen);
            h.dirty = true;
        } else if (n == 0) {
            h.running = false;
        } else if (!(errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR)) {
            h.running = false;
        }

        SDL_Event ev;
        while (SDL_PollEvent(&ev)) {
            if (ev.type == SDL_QUIT) {
                h.running = false;
            } else if (ev.type == SDL_TEXTINPUT) {
                pty_send(&h, ev.text.text);
            } else if (ev.type == SDL_KEYDOWN) {
                bool ctrl = (ev.key.keysym.mod & KMOD_CTRL) != 0;
                bool alt = (ev.key.keysym.mod & KMOD_ALT) != 0;
                bool shift = (ev.key.keysym.mod & KMOD_SHIFT) != 0;
                send_key_sequence(&h, ev.key.keysym.sym, ctrl, alt, shift);
            }
        }

        rfbProcessEvents(h.vnc, 0);
        redraw(&h);

        int status = 0;
        pid_t res = waitpid(h.child_pid, &status, WNOHANG);
        if (res == h.child_pid) {
            h.running = false;
        }

        poll(&pfd, 1, 10);
    }

    if (h.child_pid > 0) {
        kill(h.child_pid, SIGTERM);
        waitpid(h.child_pid, NULL, 0);
    }
    if (h.vnc)
        rfbScreenCleanup(h.vnc);
    if (h.window)
        SDL_DestroyWindow(h.window);
    if (h.frame)
        SDL_FreeSurface(h.frame);
    if (h.font)
        TTF_CloseFont(h.font);
    if (h.vt)
        vterm_free(h.vt);
    TTF_Quit();
    SDL_Quit();
    return 0;
}
