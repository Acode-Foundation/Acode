set -e  # Exit immediately on failure


export PATH=/bin:/sbin:/usr/bin:/usr/sbin:/usr/share/bin:/usr/share/sbin:/usr/local/bin:/usr/local/sbin:/system/bin:/system/xbin:$PREFIX/local/bin
export PS1="\[\e[38;5;46m\]\u\[\033[39m\]@localhost \[\033[39m\]\w \[\033[0m\]\\$ "
export HOME=/home
export TERM=xterm-256color


required_packages="bash"
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

    # Create initrc if it doesn't exist
    if [ ! -e "$PREFIX/alpine/initrc" ]; then
        cat <<EOF > "$PREFIX/alpine/initrc"
if [[ -f ~/.bashrc ]]; then
    source ~/.bashrc
fi

if [[ -f /etc/bash/bashrc ]]; then
    source /etc/bash/bashrc
fi

export PATH=\$PATH:/bin:/sbin:/usr/bin:/usr/sbin:/usr/share/bin:/usr/share/sbin:/usr/local/bin:/usr/local/sbin
export HOME=/home
export TERM=xterm-256color
export SHELL=\$(command -v bash)

if [ -s /etc/acode_motd ]; then
    cat /etc/acode_motd
fi

EOF
    fi

    echo 'export PS1="\[\e[38;5;46m\]\u\[\e[0m\]@localhost \[\e[0m\]\w \[\e[0m\]\\$ "' >> $PREFIX/alpine/initrc
    chmod +x "$PREFIX/alpine/initrc"
    "$PREFIX/axs" -c "bash --rcfile /initrc -i"
else
    exec "$@"
fi