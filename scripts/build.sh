#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# build.sh — xflow-desktop 全平台编译打包脚本
#
# 用法:
#   ./scripts/build.sh              # 完整构建 (前端+后端+桌面)
#   ./scripts/build.sh --frontend   # 仅构建前端
#   ./scripts/build.sh --backend    # 仅构建后端
#   ./scripts/build.sh --desktop    # 仅构建桌面应用 (假设前端后端已就绪)
#   ./scripts/build.sh --skip-tauri # 构建前端+后端，跳过 Tauri 桌面打包
#   ./scripts/build.sh --clean      # 清理所有构建产物后重新构建
#   ./scripts/build.sh --no-sign    # macOS 跳过签名
#
# 自动识别系统: macOS / Linux / Windows (MSYS2/Git Bash/Cygwin)
#
# 注意: Tauri 的 resources 机制会解引用符号链接，导致 .app 体积膨胀 ~50MB。
#       因此构建桌面应用时，会临时清空 tauri.conf.json 的 resources 配置，
#       构建完成后手动 cp -R 复制 backend/nodejs 到 .app (保留符号链接)。
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

# ── 颜色 ─────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ OK ]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERR]${NC}  $*" >&2; }
step()  { echo -e "${CYAN}━━━▶${NC} $*"; }

# ── 平台检测 ──────────────────────────────────────────────────
detect_platform() {
    local uname_out
    uname_out="$(uname -s 2>/dev/null || echo UNKNOWN)"

    case "${uname_out}" in
        Linux*)     PLATFORM=linux;;
        Darwin*)    PLATFORM=macos;;
        MINGW*|MSYS*|CYGWIN*)  PLATFORM=windows;;
        *)          PLATFORM=unknown;;
    esac

    # 架构检测
    local arch
    arch="$(uname -m 2>/dev/null || echo unknown)"
    case "${arch}" in
        x86_64|amd64)  ARCH=x64;;
        arm64|aarch64) ARCH=arm64;;
        *)             ARCH=unknown;;
    esac

    info "平台: ${PLATFORM} (${ARCH})"
}

# ── 检测最佳 Python 版本 ────────────────────────────────────────
resolve_python() {
    if [[ -n "${PYTHON3_BIN:-}" ]]; then
        if ${PYTHON3_BIN} --version &>/dev/null; then
            PYTHON_CMD="${PYTHON3_BIN}"
            return
        else
            warn "PYTHON3_BIN=${PYTHON3_BIN} 不可用，自动检测..."
        fi
    fi

    local candidates=("python3.12" "python3.11" "python3")
    for cmd in "${candidates[@]}"; do
        if command -v "${cmd}" &>/dev/null; then
            local ver
            ver="$(${cmd} -c 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo 0.0)"
            if [[ "${ver}" == "3.13" || "${ver}" == "3.14" ]]; then
                warn "检测到 Python ${ver}，因 macOS 兼容性问题跳过 (推荐 3.12)"
                continue
            fi
            PYTHON_CMD="${cmd}"
            return
        fi
    done

    if command -v python3 &>/dev/null; then
        PYTHON_CMD="python3"
        return
    fi

    PYTHON_CMD=""
}

# ── 依赖检查 ──────────────────────────────────────────────────
check_deps() {
    step "检查构建依赖..."

    local missing=()

    if command -v node &>/dev/null; then
        info "Node.js $(node --version)"
    else
        missing+=("node")
    fi

    if command -v npm &>/dev/null; then
        info "npm $(npm --version)"
    else
        missing+=("npm")
    fi

    if [[ -n "${PYTHON_CMD}" ]]; then
        info "Python $(${PYTHON_CMD} --version 2>&1 | cut -d' ' -f2) (${PYTHON_CMD})"
    else
        missing+=("python3")
    fi

    if [[ "${BUILD_DESKTOP}" == "true" ]]; then
        if command -v cargo &>/dev/null; then
            info "Rust $(rustc --version 2>&1 | cut -d' ' -f2)"
        else
            missing+=("cargo (Rust)")
        fi
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        err "缺少必要依赖: ${missing[*]}"
        exit 1
    fi

    ok "所有依赖已就绪"
}

# ── Python venv 设置 ──────────────────────────────────────────
setup_venv() {
    step "设置 Python 虚拟环境 (${PYTHON_CMD})..."

    if [[ "${PLATFORM}" == "windows" ]]; then
        local venv_python="backend/venv/Scripts/python.exe"
    else
        local venv_python="backend/venv/bin/python"
    fi
    local venv_pip_cmd="${venv_python} -m pip"

    # 版本不匹配时重建 venv
    if [[ -f "${venv_python}" ]]; then
        local venv_ver host_ver
        venv_ver="$(${venv_python} -c 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo unknown)"
        host_ver="$(${PYTHON_CMD} -c 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo unknown)"
        if [[ "${venv_ver}" != "${host_ver}" ]]; then
            warn "venv Python ${venv_ver} 与目标 ${host_ver} 不匹配，重建..."
            rm -rf backend/venv
        fi
    fi

    if [[ ! -f "${venv_python}" ]]; then
        info "创建 Python venv..."
        ${PYTHON_CMD} -m venv backend/venv
    fi

    # 确保 pip 可用
    if ! ${venv_python} -m pip --version &>/dev/null; then
        info "安装 pip..."
        if ! ${venv_python} -m ensurepip --upgrade; then
            ${venv_python} -c "import urllib.request; urllib.request.urlretrieve('https://bootstrap.pypa.io/get-pip.py', '/tmp/get-pip.py')" \
                || curl -fsSL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
            ${venv_python} /tmp/get-pip.py
            rm -f /tmp/get-pip.py
        fi
    fi

    info "升级 pip..."
    ${venv_pip_cmd} install --upgrade pip -q 2>/dev/null || true

    info "安装 Python 依赖..."
    ${venv_pip_cmd} install -r backend/requirements.txt -q

    if ! ${venv_python} -m PyInstaller --version &>/dev/null; then
        info "安装 PyInstaller..."
        ${venv_pip_cmd} install pyinstaller -q
    fi

    # ── 修复 macOS pyexpat/libexpat 兼容性 ────────────────────
    if [[ "${PLATFORM}" == "macos" ]]; then
        local pyexpat_so
        pyexpat_so="$(${venv_python} -c "import pyexpat; print(pyexpat.__file__)" 2>/dev/null || true)"
        if [[ -z "${pyexpat_so}" ]]; then
            info "修复 pyexpat libexpat 链接..."
            pyexpat_so="$(find "$(${venv_python} -c "import sysconfig; print(sysconfig.get_config_var('LIBDIR'))" 2>/dev/null || echo /dev/null)" \
                -name 'pyexpat.cpython-3*.darwin.so' 2>/dev/null | head -1 || true)"
            if [[ -z "${pyexpat_so}" ]]; then
                local python_real
                python_real="$(readlink -f "$(${venv_python} -c "import sys; print(sys.executable)" 2>/dev/null)" 2>/dev/null || true)"
                if [[ -n "${python_real}" ]]; then
                    local dynload_dir
                    dynload_dir="$(dirname "${python_real}")/../lib/python3.1*/lib-dynload"
                    pyexpat_so="$(find "${dynload_dir}" -name 'pyexpat.cpython-3*.darwin.so' 2>/dev/null | head -1 || true)"
                fi
            fi

            local homebrew_expat="/opt/homebrew/opt/expat/lib/libexpat.1.dylib"
            if [[ -n "${pyexpat_so}" && -f "${homebrew_expat}" ]]; then
                info "重链接: ${pyexpat_so} → ${homebrew_expat}"
                if install_name_tool -change /usr/lib/libexpat.1.dylib "${homebrew_expat}" "${pyexpat_so}" 2>/dev/null; then
                    codesign --force --sign - "${pyexpat_so}" 2>/dev/null || true
                    ok "pyexpat 已修复"
                else
                    warn "无法修复 pyexpat，后端构建可能失败"
                fi
            fi
        fi
    fi

    # ── 修补 PyInstaller mac_ver bug ──────────────────────────
    local compat_file
    compat_file="$(find backend/venv -path '*/PyInstaller/compat.py' 2>/dev/null | head -1 || true)"
    if [[ -n "${compat_file}" ]] && grep -q "for x in platform.mac_ver.*split.*if is_darwin" "${compat_file}" 2>/dev/null; then
        if ! grep -q "if x)" "${compat_file}" 2>/dev/null; then
            info "修补 PyInstaller mac_ver bug..."
            ${venv_python} -c "
import sys
p = sys.argv[1]
with open(p) as f: c = f.read()
old = \"int(x) for x in platform.mac_ver()[0].split('.') if is_darwin\"
new = \"int(x) for x in platform.mac_ver()[0].split('.') if x) if is_darwin\"
if old in c and 'if x)' not in c:
    c = c.replace(old, new)
    with open(p, 'w') as f: f.write(c)
    print('Patched')
" "${compat_file}" 2>/dev/null || true
        fi
    fi

    ok "Python venv 已就绪"
}

# ── 前端 npm install ──────────────────────────────────────────
setup_frontend() {
    step "安装前端依赖..."
    if [[ ! -d "frontend/node_modules" ]]; then
        (cd frontend && npm install --legacy-peer-deps)
    fi
    ok "前端依赖已就绪"
}

# ── 构建前端 ──────────────────────────────────────────────────
build_frontend() {
    step "构建前端 (Next.js static export)..."
    export DESKTOP_BUILD=true
    export NEXT_PUBLIC_DESKTOP_BUILD=true
    (cd frontend && npm run build)

    if [[ -f "frontend/out/index.html" ]]; then
        ok "前端构建完成 → frontend/out/"
    else
        err "前端构建失败"
        exit 1
    fi
}

# ── 构建后端 ──────────────────────────────────────────────────
build_backend() {
    step "构建后端 (PyInstaller)..."

    if [[ "${PLATFORM}" == "windows" ]]; then
        local venv_python="venv/Scripts/python.exe"
    else
        local venv_python="venv/bin/python"
    fi

    (cd backend && ${venv_python} -m PyInstaller openyak.spec --noconfirm)

    local backend_bin="openyak-backend"
    if [[ "${PLATFORM}" == "windows" ]]; then
        backend_bin="openyak-backend.exe"
    fi

    if [[ -f "backend/dist/openyak-backend/${backend_bin}" ]]; then
        ok "后端构建完成 → backend/dist/openyak-backend/"
    else
        err "后端构建失败"
        exit 1
    fi
}

# ── 构建桌面应用 ──────────────────────────────────────────────
build_desktop() {
    step "构建桌面应用 (Tauri)..."

    # 确保 Tauri npm 依赖
    if [[ ! -d "desktop-tauri/node_modules" ]]; then
        info "安装 Tauri npm 依赖..."
        npm --prefix desktop-tauri install
    fi

    # 确保 Node.js 运行时已下载
    if [[ ! -d "backend/resources/nodejs" ]]; then
        info "下载 Node.js 运行时..."
        ${PYTHON_CMD} backend/scripts/download_node.py --output backend/resources/nodejs
        ok "Node.js 运行时已下载"
    fi

    # 同步元数据
    info "同步桌面元数据..."
    npm run sync:desktop-meta 2>/dev/null || node scripts/sync-desktop-meta.mjs 2>/dev/null || true

    # ── 临时修改 tauri.conf.json ─────────────────────────────
    # 关键修复: 清空 resources，避免 Tauri 解引用符号链接导致体积膨胀
    local tauri_conf="desktop-tauri/src-tauri/tauri.conf.json"
    local tauri_conf_bak="${tauri_conf}.bak"
    cp "${tauri_conf}" "${tauri_conf_bak}"
    restore_tauri_config() {
        if [[ -f "${tauri_conf_bak}" ]]; then
            mv "${tauri_conf_bak}" "${tauri_conf}"
        fi
    }
    trap restore_tauri_config EXIT

    info "临时修改 tauri.conf.json (禁用 beforeBuildCommand + 清空 resources)..."
    python3 - "${tauri_conf}" "${NO_SIGN}" <<'PY'
import json, sys
path, no_sign = sys.argv[1], sys.argv[2] == "true"
with open(path, encoding="utf-8") as f:
    cfg = json.load(f)
cfg["build"]["beforeBuildCommand"] = ""
cfg["bundle"]["resources"] = {}
if no_sign:
    cfg["bundle"].setdefault("macOS", {})["signingIdentity"] = None
    cfg["bundle"]["createUpdaterArtifacts"] = False
with open(path, "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
PY

    # ── Tauri 构建 ──────────────────────────────────────────
    local tauri_args=()
    if [[ "${PLATFORM}" == "macos" ]]; then
        tauri_args=(--bundles dmg,app)
    fi

    (cd desktop-tauri && cargo tauri build ${tauri_args[*]+"${tauri_args[@]}"})

    # 恢复 tauri.conf.json
    restore_tauri_config
    trap - EXIT

    # ── 手动复制 backend/nodejs 到 .app ─────────────────────
    # 关键: cp -R 保留符号链接，避免 Tauri resources 机制解引用导致 ~50MB 膨胀
    if [[ "${PLATFORM}" == "macos" ]]; then
        step "打包资源到 .app (保留符号链接)..."

        local bundle_dir="desktop-tauri/src-tauri/target/release/bundle"
        local app_path
        app_path="$(ls -td "${bundle_dir}"/macos/*.app 2>/dev/null | head -1 || true)"

        if [[ -n "${app_path}" ]]; then
            local resources_dir="${app_path}/Contents/Resources"

            # 清理旧资源
            rm -rf "${resources_dir}/backend" "${resources_dir}/nodejs"

            # 复制后端 (保留符号链接)
            info "复制 backend → .app..."
            cp -R backend/dist/openyak-backend "${resources_dir}/backend"
            chmod +x "${resources_dir}/backend/openyak-backend"

            # 复制 Node.js 运行时
            if [[ -d "backend/resources/nodejs" ]]; then
                info "复制 nodejs → .app..."
                cp -R backend/resources/nodejs "${resources_dir}/nodejs"
                chmod +x "${resources_dir}/nodejs/bin/node" 2>/dev/null || true
            fi

            ok "资源已打包到 .app"

            # ── 重新生成 DMG (包含手动复制的资源) ────────────
            local dmg_path
            dmg_path="$(ls -t "${bundle_dir}"/dmg/*.dmg 2>/dev/null | head -1 || true)"
            if [[ -n "${dmg_path}" ]] && command -v hdiutil >/dev/null 2>&1; then
                info "重新生成 DMG (包含后端资源)..."
                local staging_dir="${bundle_dir}/dmg-staging"
                rm -rf "${staging_dir}"
                mkdir -p "${staging_dir}"
                cp -R "${app_path}" "${staging_dir}/OpenYak.app"
                ln -s /Applications "${staging_dir}/Applications"
                rm -f "${dmg_path}"
                hdiutil create -volname "OpenYak" -srcfolder "${staging_dir}" -ov -format UDZO "${dmg_path}" >/dev/null
                rm -rf "${staging_dir}"
                ok "DMG 已重新生成"
            fi

            # 报告
            local app_size
            app_size="$(du -sh "${app_path}" | awk '{print $1}')"
            ok "App: ${app_path} (${app_size})"
            if [[ -n "${dmg_path:-}" ]]; then
                ok "DMG: ${dmg_path} ($(du -sh "${dmg_path}" | awk '{print $1}'))"
            fi
        fi

    elif [[ "${PLATFORM}" == "linux" ]]; then
        local deb_path appimage_path
        deb_path="$(find desktop-tauri/src-tauri/target/release/bundle/deb -name '*.deb' 2>/dev/null | head -1 || true)"
        appimage_path="$(find desktop-tauri/src-tauri/target/release/bundle/appimage -name '*.AppImage' 2>/dev/null | head -1 || true)"
        [[ -n "${deb_path}" ]] && ok "DEB: ${deb_path}"
        [[ -n "${appimage_path}" ]] && ok "AppImage: ${appimage_path}"

    elif [[ "${PLATFORM}" == "windows" ]]; then
        local msi_path nsis_path
        msi_path="$(find desktop-tauri/src-tauri/target/release/bundle/msi -name '*.msi' 2>/dev/null | head -1 || true)"
        nsis_path="$(find desktop-tauri/src-tauri/target/release/bundle/nsis -name '*.exe' 2>/dev/null | head -1 || true)"
        [[ -n "${msi_path}" ]] && ok "MSI: ${msi_path}"
        [[ -n "${nsis_path}" ]] && ok "NSIS: ${nsis_path}"
    fi

    ok "桌面应用构建完成!"
}

# ── 清理 ──────────────────────────────────────────────────────
do_clean() {
    step "清理构建产物..."
    rm -rf frontend/out frontend/.next
    rm -rf backend/dist backend/build
    rm -rf desktop-tauri/src-tauri/target/release
    ok "构建产物已清理"
}

# ── 主流程 ────────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  xflow-desktop 编译打包脚本${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
    echo ""

    BUILD_FRONTEND="true"
    BUILD_BACKEND="true"
    BUILD_DESKTOP="true"
    DO_CLEAN="false"
    NO_SIGN="false"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --frontend)    BUILD_BACKEND="false"; BUILD_DESKTOP="false";;
            --backend)     BUILD_FRONTEND="false"; BUILD_DESKTOP="false";;
            --desktop)     BUILD_FRONTEND="false"; BUILD_BACKEND="false";;
            --skip-tauri)  BUILD_DESKTOP="false";;
            --clean)       DO_CLEAN="true";;
            --no-sign)     NO_SIGN="true";;
            -h|--help)
                echo "用法: $0 [选项]"
                echo ""
                echo "选项:"
                echo "  --frontend    仅构建前端"
                echo "  --backend     仅构建后端"
                echo "  --desktop     仅构建桌面应用"
                echo "  --skip-tauri  构建前端+后端，跳过 Tauri"
                echo "  --clean       清理后重新构建"
                echo "  --no-sign     macOS 跳过签名"
                echo "  -h, --help    显示帮助"
                exit 0
                ;;
            *)
                err "未知参数: $1"
                exit 1
                ;;
        esac
        shift
    done

    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local project_root
    project_root="$(cd "${script_dir}/.." && pwd)"
    cd "${project_root}"
    info "项目根目录: ${project_root}"

    detect_platform
    resolve_python

    if [[ "${DO_CLEAN}" == "true" ]]; then
        do_clean
    fi

    check_deps

    if [[ "${BUILD_FRONTEND}" == "true" ]]; then
        setup_frontend
        build_frontend
    fi

    if [[ "${BUILD_BACKEND}" == "true" ]]; then
        setup_venv
        build_backend
    fi

    if [[ "${BUILD_DESKTOP}" == "true" ]]; then
        build_desktop
    fi

    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✅ 构建完成!${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
    echo ""
}

main "$@"
