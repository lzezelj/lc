# Source from the lc user's ~/.bashrc. A function forwards quoted arguments.
restore() {
  sudo /usr/bin/bash /home/lc/apps/lc/scripts/database-backup.sh restore "$@"
}
