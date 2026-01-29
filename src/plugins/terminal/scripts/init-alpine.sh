export PATH=/bin:/sbin:/usr/bin:/usr/sbin:/usr/share/bin:/usr/share/sbin:/usr/local/bin:/usr/local/sbin:/system/bin:/system/xbin:$PREFIX/local/bin
export PS1="\[\e[38;5;46m\]\u\[\033[39m\]@localhost \[\033[39m\]\w \[\033[0m\]\\$ "
export HOME=/home
export TERM=xterm-256color


required_packages="bash command-not-found tzdata wget"
missing_packages=""

for pkg in $required_packages; do
    if ! apk info -e "$pkg" >/dev/null 2>&1; then
        missing_packages="$missing_packages $pkg"
    fi
done

if [ -n "$missing_packages" ]; then
    echo -e "\e[34;1m[*] \e[0mInstalling important packages\e[0m"
    apk update && apk upgrade
    apk add $missing_packages
    if [ $? -eq 0 ]; then
        echo -e "\e[32;1m[+] \e[0mSuccessfully installed\e[0m"
    fi
    echo -e "\e[34m[*] \e[0mUse \e[32mapk\e[0m to install new packages\e[0m"
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

    mkdir -p "$PREFIX/.configured"
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

    # Create acode CLI tool
    if [ ! -e "$PREFIX/alpine/usr/local/bin/acode" ]; then
        mkdir -p "$PREFIX/alpine/usr/local/bin"
        cat <<'ACODE_CLI' > "$PREFIX/alpine/usr/local/bin/acode"
#!/bin/bash
# acode - Open files/folders in Acode editor
# Uses OSC escape sequences to communicate with the Acode terminal

usage() {
    echo "Usage: acode [file/folder...]"
    echo ""
    echo "Open files or folders in Acode editor."
    echo ""
    echo "Examples:"
    echo "  acode file.txt      # Open a file"
    echo "  acode .             # Open current folder"
    echo "  acode ~/project     # Open a folder"
    echo "  acode -h, --help    # Show this help"
}

get_abs_path() {
    local path="$1"
    local abs_path
    abs_path=$(realpath -- "$path" 2>/dev/null)
    if [[ $? -ne 0 ]]; then
        if [[ "$path" == /* ]]; then
            abs_path="$path"
        else
            abs_path="$PWD/$path"
        fi
    fi
    echo "$abs_path"
}

open_in_acode() {
    local path=$(get_abs_path "$1")
    local type="file"
    [[ -d "$path" ]] && type="folder"
    
    # Send OSC 7777 escape sequence: \e]7777;cmd;type;path\a
    # The terminal component will intercept and handle this
    printf '\e]7777;open;%s;%s\a' "$type" "$path"
}

if [[ $# -eq 0 ]]; then
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
            if [[ -e "$arg" ]]; then
                open_in_acode "$arg"
            else
                echo "Error: '$arg' does not exist" >&2
                exit 1
            fi
            ;;
    esac
done
ACODE_CLI
        chmod +x "$PREFIX/alpine/usr/local/bin/acode"
    fi

    # Create initrc if it doesn't exist
    #initrc runs in bash so we can use bash features 
if [ ! -e "$PREFIX/alpine/initrc" ]; then
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

PROMPT_COMMAND='_PS1_PATH=$(_shorten_path); _PS1_EXIT=$?'

# Source user configs AFTER defaults (so user can override PROMPT_COMMAND)
if [ -f "$HOME/.bashrc" ]; then
    source "$HOME/.bashrc"
fi

if [ -f /etc/bash/bashrc ]; then
    source /etc/bash/bashrc
fi


# Display MOTD if available
if [ -s /etc/acode_motd ]; then
    cat /etc/acode_motd
fi

# Command-not-found handler
command_not_found_handle() {
    cmd="$1"
    pkg=""
    green="\e[1;32m"
    reset="\e[0m"

    pkg=$(apk search -x "cmd:$cmd" 2>/dev/null | awk -F'-[0-9]' '{print $1}' | head -n 1)

    if [ -n "$pkg" ]; then
        echo -e "The program '$cmd' is not installed.\nInstall it by executing:\n ${green}apk add $pkg${reset}" >&2
    else
        echo "The program '$cmd' is not installed and no package provides it." >&2
    fi

    return 127
}

EOF
fi

# Add PS1 only if not already present
if ! grep -q 'PS1=' "$PREFIX/alpine/initrc"; then
    # Smart path shortening (fish-style: ~/p/s/components)
    echo 'PS1="\[\033[1;32m\]\u\[\033[0m\]@localhost \[\033[1;34m\]\$_PS1_PATH\[\033[0m\] \[\$([ \$_PS1_EXIT -ne 0 ] && echo \"\033[31m\")\]\$\[\033[0m\] "' >> "$PREFIX/alpine/initrc"
    # Simple prompt (uncomment below and comment above if you prefer full paths)
    # echo 'PS1="\[\033[1;32m\]\u\[\033[0m\]@localhost \[\033[1;34m\]\w\[\033[0m\] \$ "' >> "$PREFIX/alpine/initrc"
fi

chmod +x "$PREFIX/alpine/initrc"

#actual source
#everytime a terminal is started initrc will run
"$PREFIX/axs" -c "bash --rcfile /initrc -i"

else
    exec "$@"
fi
