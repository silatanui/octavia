# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Octavia desktop API server."""

from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None

datas = []
binaries = []
hiddenimports = collect_submodules('app')

for pkg in ('uvicorn', 'fastapi', 'starlette', 'anyio', 'sqlalchemy', 'pydantic', 'pydantic_settings', 'jose', 'passlib', 'bcrypt', 'email_validator'):
    try:
        pkg_datas, pkg_binaries, pkg_hidden = collect_all(pkg)
        datas += pkg_datas
        binaries += pkg_binaries
        hiddenimports += pkg_hidden
    except Exception:
        pass

a = Analysis(
    ['desktop_run.py'],
    pathex=['.'],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports + [
        'pymysql',
        'cryptography',
        'app.main',
        'app.api.admin',
        'app.api.alerts',
        'app.api.auth',
        'app.api.dashboard',
        'app.api.downtime',
        'app.api.machines',
        'app.api.production',
        'app.api.quality',
        'app.api.work_orders',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='octavia-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='octavia-server',
)
