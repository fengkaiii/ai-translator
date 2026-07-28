#!/bin/bash
# electron-builder deb 安装后脚本。
# Ubuntu 24+ 默认限制非特权 user namespace，默认模板会把 chrome-sandbox 设为 0755，
# 导致 Electron 直接 FATAL；这里始终设为 4755，并安装 AppArmor unconfined 配置。

if type update-alternatives 2>/dev/null >&1; then
  if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
    rm -f '/usr/bin/${executable}'
  fi
  update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 \
    || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
  ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# 始终启用 SUID sandbox helper（适配 Ubuntu AppArmor 限制）
chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true

if hash update-mime-database 2>/dev/null; then
  update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
  update-desktop-database /usr/share/applications || true
fi

# 刷新图标缓存，避免仅有 1024 尺寸时菜单显示通用图标
if hash gtk-update-icon-cache 2>/dev/null; then
  gtk-update-icon-cache -f /usr/share/icons/hicolor || true
fi

# Ubuntu 24+ AppArmor：给本应用放行 userns，避免仅靠 SUID 仍被拦截
APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
if hash apparmor_parser 2>/dev/null && apparmor_status --enabled > /dev/null 2>&1; then
  cat > "$APPARMOR_PROFILE_TARGET" <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile ${executable} "/opt/${sanitizedProductName}/${executable}" flags=(unconfined) {
  userns,
  include if exists <local/${executable}>
}
EOF
  # 旧版 AppArmor（无 abi/4.0）跳过加载，避免安装失败
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_TARGET" > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; }; then
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET" || true
    fi
  else
    rm -f "$APPARMOR_PROFILE_TARGET"
    echo "Skipping AppArmor profile (unsupported apparmor_parser)"
  fi
fi
