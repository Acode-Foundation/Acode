export PATH=/bin:/sbin:/usr/bin:/usr/sbin:/usr/share/bin:/usr/share/sbin:/usr/local/bin:/usr/local/sbin:/system/bin:/system/xbin:$PREFIX/local/bin
export HOME=/home
export TERM=xterm-256color


# ── Package check (runs every startup, file-stat only — negligible cost) ──
# Check by file existence rather than apk info (which is unreliable in proot)
is_apk_installed() {
    local package_name="$1"
    [ -f /lib/apk/db/installed ] && grep -q "^P:${package_name}$" /lib/apk/db/installed
}

find_bash_path() {
    command -v bash 2>/dev/null || true
}

missing_packages=""
[ -z "$(find_bash_path)" ] && missing_packages="$missing_packages bash"
[ ! -f /usr/share/zoneinfo/UTC ] && missing_packages="$missing_packages tzdata"
[ ! -f /usr/bin/wget ] && missing_packages="$missing_packages wget"
! is_apk_installed command-not-found && missing_packages="$missing_packages command-not-found"

if [ -n "$missing_packages" ]; then
    echo -e "\e[34;1m[*] \e[0mInstalling packages:$missing_packages\e[0m"

    # In proot, post-install scripts may fail with error 127;
    # manual fixup below compensates if needed.
    apk update 2>/dev/null

    apk add $missing_packages 2>/dev/null
    if [ $? -ne 0 ]; then
        echo -e "\e[33;1m[!] \e[0mRetrying with mirror...\e[0m"
        cp /etc/apk/repositories /etc/apk/repositories.bak
        echo "https://mirrors.tuna.tsinghua.edu.cn/alpine/v3.21/main" > /etc/apk/repositories
        echo "https://mirrors.tuna.tsinghua.edu.cn/alpine/v3.21/community" >> /etc/apk/repositories
        apk update 2>/dev/null
        apk add $missing_packages 2>/dev/null
        mv /etc/apk/repositories.bak /etc/apk/repositories 2>/dev/null
    fi

    bash_path="$(find_bash_path)"

    # Post-install fixup: ensure /bin/bash exists if bash resolves elsewhere.
    if [ -n "$bash_path" ] && [ ! -e /bin/bash ]; then
        ln -sf "$bash_path" /bin/bash 2>/dev/null
    fi

    # Ensure /etc/shells has bash
    if [ -n "$bash_path" ] && ! grep -q "/bin/bash" /etc/shells 2>/dev/null; then
        echo "/bin/bash" >> /etc/shells 2>/dev/null
    fi

    # Verify
    [ -z "$bash_path" ] && echo -e "\e[31;1m[!] \e[0mbash still missing\e[0m"
    [ ! -f /usr/bin/wget ] && echo -e "\e[31;1m[!] \e[0mwget still missing\e[0m"
fi


if [ ! -f /linkerconfig/ld.config.txt ]; then
    mkdir -p /linkerconfig
    touch /linkerconfig/ld.config.txt
fi


if [ "$1" = "--installing" ]; then
    echo "Configuring timezone..."
    
    if [ -n "$ANDROID_TZ" ] && [ -f "/usr/share/zoneinfo/$ANDROID_TZ" ]; then
        ln -sf "/usr/share/zoneinfo/$ANDROID_TZ" /etc/localtime
        echo "$ANDROID_TZ" > /etc/timezone
        echo "Timezone set to: $ANDROID_TZ"
    else
        echo "Failed to detect timezone"
    fi

    # .configured marker is created by JS layer (system.writeText) after proot exits.
    # Do NOT create it here — proot bind-mount mkdir causes Java mkdirs() to fail
    # because it sees the directory already exists.
    echo "Installation completed."
    exit 0
fi


if [ "$#" -eq 0 ]; then
    echo "$$" > "$PREFIX/pid"
    chmod +x "$PREFIX/axs"

    if [ ! -e "$PREFIX/alpine/etc/acode_motd" ]; then
        cat <<EOF > "$PREFIX/alpine/etc/acode_motd"
Welcome to Alpine Linux in Acode!

Working with packages:

 - Search:  apk search <query>
 - Install: apk add <package>
 - Uninstall: apk del <package>
 - Upgrade: apk update && apk upgrade

EOF
    fi

    # Create/update initrc (always overwrite to keep in sync with app updates)
    # Cost: ~3KB heredoc write per startup, sub-millisecond — negligible.
    #initrc runs in bash so we can use bash features 
    cat <<'EOF' > "$PREFIX/alpine/initrc"
# Source rc files if they exist

if [ -f "/etc/profile" ]; then
    source "/etc/profile"
fi

# Environment setup
export PATH=$PATH:/bin:/sbin:/usr/bin:/usr/sbin:/usr/share/bin:/usr/share/sbin:/usr/local/bin:/usr/local/sbin

export HOME=/home 
export TERM=xterm-256color 
SHELL=/bin/bash
export PIP_BREAK_SYSTEM_PACKAGES=1

# Default prompt with fish-style path shortening (~/p/s/components)
# To use custom prompts (Starship, Oh My Posh, etc.), just init them in ~/.bashrc:
#   eval "$(starship init bash)"
_shorten_path() {
    local path="$PWD"
    
    if [[ "$HOME" != "/" && "$path" == "$HOME" ]]; then
        echo "~"
        return
    elif [[ "$HOME" != "/" && "$path" == "$HOME/"* ]]; then
        path="~${path#$HOME}"
    fi
    
    [[ "$path" == "~" ]] && echo "~" && return
    
    local parts result=""
    IFS='/' read -ra parts <<< "$path"
    local len=${#parts[@]}
    
    for ((i=0; i<len; i++)); do
        [[ -z "${parts[i]}" ]] && continue
        if [[ $i -lt $((len-1)) ]]; then
            result+="${parts[i]:0:1}/"
        else
            result+="${parts[i]}"
        fi
    done
    
    [[ "$path" == /* ]] && echo "/$result" || echo "$result"
}

_PS1_PATH="$(_shorten_path)"
_PS1_EXIT=0

_update_prompt_state() {
    local last_exit=$?
    _PS1_PATH="$(_shorten_path)"
    _PS1_EXIT=$last_exit
}

PROMPT_COMMAND='_update_prompt_state'

# Source user configs AFTER defaults (so user can override PROMPT_COMMAND)
if [ -f "$HOME/.bashrc" ]; then
    source "$HOME/.bashrc"
fi

if [ -f /etc/bash/bashrc ]; then
    source /etc/bash/bashrc
fi

# Display MOTD (only source that reliably runs in proot bash)
if [ -s /etc/acode_motd ]; then
    cat /etc/acode_motd
fi

# Work around proot shebang execution failures for Bash's missing-command hook.
# Bash normally auto-executes /usr/libexec/command-not-found when a command is
# missing, but direct shebang execution can fail in proot with
# "bad interpreter: Bad address". Run the original script explicitly through
# /bin/sh so the script keeps working without relying on the broken shebang path.
command_not_found_handle() {
    if [ -x /usr/libexec/command-not-found ]; then
        /bin/sh /usr/libexec/command-not-found "$@"
        return $?
    fi

    printf '%s: command not found\n' "$1" >&2
    return 127
}

# acode CLI: defined as a bash function instead of a standalone script.
# In proot, a script with #!/bin/bash triggers execve("/bin/bash"), which the
# kernel handles in kernel-space. proot relies on ptrace to intercept execve and
# translate paths, but the kernel's shebang-triggered second execve can bypass
# proot's path translation (especially with --link2symlink or Android's ptrace
# restrictions), causing "bad interpreter: No such file or directory".
# A bash function runs in the current process — no execve, no shebang, no issue.
_acode_get_abs_path() {
    local path="$1" abs_path=""
    if command -v realpath >/dev/null 2>&1; then
        abs_path=$(realpath -- "$path" 2>/dev/null)
    fi
    if [[ -z "$abs_path" ]]; then
        if [[ -d "$path" ]]; then
            abs_path=$(cd -- "$path" 2>/dev/null && pwd -P)
        elif [[ -e "$path" ]]; then
            abs_path="$(cd -- "$(dirname -- "$path")" 2>/dev/null && pwd -P)/$(basename -- "$path")"
        elif [[ "$path" == /* ]]; then
            abs_path="$path"
        else
            abs_path="$PWD/$path"
        fi
    fi
    echo "$abs_path"
}
_acode_open() {
    local path=$(_acode_get_abs_path "$1")
    local type="file"
    [[ -d "$path" ]] && type="folder"
    printf '\e]7777;open;%s;%s\a' "$type" "$path"
}
acode() {
    if [[ $# -eq 0 ]]; then
        _acode_open "."
        return 0
    fi
    local arg
    for arg in "$@"; do
        case "$arg" in
            -h|--help)
                echo "Usage: acode [file/folder...]"
                echo ""
                echo "Open files or folders in Acode editor."
                echo ""
                echo "Examples:"
                echo "  acode file.txt      # Open a file"
                echo "  acode .             # Open current folder"
                echo "  acode ~/project     # Open a folder"
                echo "  acode -h, --help    # Show this help"
                return 0
                ;;
            *)
                if [[ -e "$arg" ]]; then
                    _acode_open "$arg"
                else
                    echo "Error: '$arg' does not exist" >&2
                    return 1
                fi
                ;;
        esac
    done
}

EOF

# Add PS1 only if not already present
if ! grep -q 'PS1=' "$PREFIX/alpine/initrc"; then
    # Smart path shortening (fish-style: ~/p/s/components)
    echo 'PS1="\[\033[1;32m\]\u\[\033[0m\]@localhost \[\033[1;34m\]\$_PS1_PATH\[\033[0m\] \[\$([ "${_PS1_EXIT:-0}" -ne 0 ] && echo \"\033[31m\")\]\$\[\033[0m\] "' >> "$PREFIX/alpine/initrc"
    # Simple prompt (uncomment below and comment above if you prefer full paths)
    # echo 'PS1="\[\033[1;32m\]\u\[\033[0m\]@localhost \[\033[1;34m\]\w\[\033[0m\] \$ "' >> "$PREFIX/alpine/initrc"
fi

chmod +x "$PREFIX/alpine/initrc"

#actual source
#everytime a terminal is started initrc will run
# Required for the WebView's HTTP probe and terminal requests to localhost:8767.
# Upstream Cordova commonly runs under https://localhost, which axs already
# allows by default. In this repo, terminal startup and localhost readiness
# probes can still originate from contexts outside axs's built-in default
# allowlist. Without this CORS allowance, fetch() fails with
# "TypeError: Failed to fetch" even though axs is already listening, which
# triggers false repair/reinstall loops.
# axs currently exposes only its default https://localhost policy or a global
# allow-any-origin switch; it does not support an explicit origin allowlist yet.
# Tightening this inside the shell wrapper is not possible: Origin validation has
# to happen inside axs itself, where the HTTP request is handled. Until axs gains
# per-origin CORS or an equivalent auth gate, keep this stopgap so terminal
# startup and localhost readiness probes remain functional.
"$PREFIX/axs" -c "bash --rcfile /initrc -i"

else
    exec "$@"
fi
