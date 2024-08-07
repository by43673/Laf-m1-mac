require('v8-compile-cache');
const path = require('path');
const {
    app,
    BrowserWindow,
    ipcMain,
    protocol,
    shell,
    dialog,
    session,
    clipboard,
    nativeImage,
} = require('electron');
const Store = require('electron-store');
const log = require('electron-log');
const prompt = require('electron-prompt');
const { autoUpdater } = require('electron-updater');
const DiscordRPC = require('discord-rpc');
const os = require('os');
const fetch = require('node-fetch');
const tmi = require('tmi.js');

const platformType = process.platform;
const config = new Store();
const devMode = config.get('devmode', false);
const ClientID = '810350252023349248';
let twitchToken = config.get('twitchToken', null);
let splashWindow = null;
let gameWindow = null;
const isRPCEnabled = config.get('enableRPC', true);

log.info(`LaF v${app.getVersion()}${devMode ? '@DEV' : ''}`);
log.info(`Electron: ${process.versions.electron}, Node.js: ${process.versions.node}, Chromium: ${process.versions.chrome}`);

const wm = require('./js/util/wm');

// Remove potentially unsafe method
delete nativeImage.createThumbnailFromPath;

if (!app.requestSingleInstanceLock()) {
    log.error('Another instance is already running. Exiting.');
    app.exit();
}

protocol.registerSchemesAsPrivileged([{
    scheme: 'laf',
    privileges: { secure: true, corsEnabled: true },
}]);

const langPack = require(config.get('lang', 'en_US') === 'ja_JP' ? './lang/ja_JP' : './lang/en_US');

log.info(`UI Language: ${config.get('lang', 'en_US')}`);

const initFlags = () => {
    const chromiumFlags = [
        ['disable-frame-rate-limit', null, config.get('unlimitedFPS', true)],
        ['disable-gpu-vsync', null, config.get('unlimitedFPS', true)],
        ['max-gum-fps', '9999', config.get('unlimitedFPS', true)],
        ['disable-features', 'UsePreferredIntervalForVideo', config.get('unlimitedFPS', true)],
        ['enable-features', 'DefaultPassthroughCommandDecoder', config.get('unlimitedFPS', true)],
        ['enable-features', 'CanvasOopRasterization', config.get('unlimitedFPS', true)],
        ['enable-features', 'BlinkCompositorUseDisplayThreadPriority', config.get('unlimitedFPS', true)],
        ['enable-features', 'GpuUseDisplayThreadPriority', config.get('unlimitedFPS', true)],
        ['disable-print-preview', null, config.get('unlimitedFPS', true)],
        ['disable-metrics-repo', null, config.get('unlimitedFPS', true)],
        ['disable-metrics', null, config.get('unlimitedFPS', true)],
        ['disable-logging', null, config.get('unlimitedFPS', true)],
        ['disable-breakpad', null, config.get('unlimitedFPS', true)],
        ['disable-component-update', null, config.get('unlimitedFPS', true)],
        ['disable-bundled-ppapi-flash', null, config.get('unlimitedFPS', true)],
        ['disable-2d-canvas-clip-aa', null, config.get('unlimitedFPS', true)],
        ['disable-hang-monitor', null, config.get('unlimitedFPS', true)],
        ['webrtc-max-cpu-consumption-percentage', '100', config.get('unlimitedFPS', true)],
        ['enable-highres-timer', null, config.get('unlimitedFPS', true)],
        ['enable-quic', null, config.get('unlimitedFPS', true)],
        ['quic-max-packet-length', '1460', config.get('unlimitedFPS', true)],
        ['high-dpi-support', '1', config.get('unlimitedFPS', true)],
        ['ignore-gpu-blocklist', null, config.get('unlimitedFPS', true)],
        ['disable-background-timer-throttling', null, config.get('unlimitedFPS', true)],
        ['disable-renderer-backgrounding', null, config.get('unlimitedFPS', true)],
        ['use-angle', config.get('angleType', 'default'), true],
        ['in-process-gpu', null, platformType === 'win32'],
        ['autoplay-policy', 'no-user-gesture-required', config.get('autoPlay', true)],
        ['disable-accelerated-2d-canvas', 'true', !config.get('acceleratedCanvas', true)],
    ];

    chromiumFlags.forEach(([flag, value, enabled]) => {
        if (enabled) {
            if (value === null) {
                app.commandLine.appendSwitch(flag);
            } else {
                app.commandLine.appendSwitch(flag, value);
            }
        }
    });
};
initFlags();

const launchGame = () => {
    gameWindow = wm.launchGame();
    gameWindow.once('ready-to-show', () => {
        if (splashWindow) splashWindow.destroy();
        twitchLogin();
    });
};

const initSplashWindow = () => {
    splashWindow = new BrowserWindow({
        width: 640,
        height: 320,
        frame: false,
        resizable: false,
        movable: false,
        center: true,
        show: false,
        webPreferences: {
            contextIsolation: false,
            preload: path.join(__dirname, 'js/preload/splash.js'),
        },
    });

    const initAutoUpdater = async () => {
        autoUpdater.logger = log;
        let updateCheckTimeout;

        autoUpdater.on('checking-for-update', () => {
            splashWindow.webContents.send('status', langPack.updater.checking);
            updateCheckTimeout = setTimeout(() => {
                splashWindow.webContents.send('status', langPack.updater.error);
                setTimeout(launchGame, 1000);
            }, 15000);
        });

        autoUpdater.on('update-available', (info) => {
            clearTimeout(updateCheckTimeout);
            splashWindow.webContents.send('status', `${langPack.updater.available} ${info.version}`);
        });

        autoUpdater.on('update-not-available', () => {
            clearTimeout(updateCheckTimeout);
            splashWindow.webContents.send('status', langPack.updater.uptodate);
            setTimeout(launchGame, 1000);
        });

        autoUpdater.on('error', (error) => {
            log.error(error);
            clearTimeout(updateCheckTimeout);
            splashWindow.webContents.send('status', `${langPack.updater.error} ${error.name}`);
            setTimeout(launchGame, 1000);
        });

        autoUpdater.on('download-progress', (progress) => {
            clearTimeout(updateCheckTimeout);
            splashWindow.webContents.send('status', langPack.updater.progress.replace('{0}', Math.floor(progress.percent)).replace('{1}', Math.floor(progress.bytesPerSecond / 1000)));
        });

        autoUpdater.on('update-downloaded', () => {
            clearTimeout(updateCheckTimeout);
            splashWindow.webContents.send('status', langPack.updater.downloaded);
            setTimeout(() => autoUpdater.quitAndInstall(), 3000);
        });

        autoUpdater.autoDownload = true;
        autoUpdater.allowPrerelease = devMode;
        autoUpdater.checkForUpdates();
    };

    splashWindow.removeMenu();
    splashWindow.loadFile(path.join(__dirname, 'html/splashWindow.html'));
    splashWindow.webContents.once('did-finish-load', () => {
        splashWindow.show();
        initAutoUpdater();
    });
};

const initTwitchChat = () => {
    const twitchAcc = config.get('twitchAcc', null);
    if (!twitchAcc) return;

    log.info('Twitch Chatbot: Initializing...');
    const tclient = new tmi.Client({
        options: { debug: true },
        logger: log,
        identity: {
            username: twitchAcc,
            password: `oauth:${twitchToken}`,
        },
        channels: [twitchAcc],
    });

    tclient.connect().catch(log.error);
    tclient.on('message', (channel, tags, message, self) => {
        if (self || !config.get('enableLinkCmd', false) || !config.get('isUserLive', false)) return;
        if (message.toLowerCase() === '!link') {
            ipcMain.handleOnce('sendLink', (e, v) => {
                tclient.say(channel, `@${tags.username} ${v}`);
            });
            gameWindow.webContents.send('getLink');
        }
    });
};

const getUserIsLive = () => {
    fetch(`https://api.twitch.tv/helix/streams?user_login=${config.get('twitchAcc', null)}`, {
        headers: {
            Authorization: `Bearer ${twitchToken}`,
            'Client-ID': ClientID,
        },
    })
        .then((r) => r.json())
        .then((r) => {
            if (r.data[0]) {
                config.set('isUserLive', true);
                log.info('Twitch: User is LIVE');
                if (config.get('twitchOverlay', false)) gameWindow.webContents.send('twitchOnline', r.data[0]);
            } else {
                config.set('isUserLive', false);
                log.info('Twitch: User is OFFLINE');
                gameWindow.webContents.send('twitchOffline');
            }
        })
        .catch((err) => log.error('Twitch API:', err));
};

const refreshTwitchToken = () => {
    fetch(`https://id.twitch.tv/oauth2/token?client_id=${ClientID}&client_secret=${config.get('clientSecret', '')}&grant_type=refresh_token&refresh_token=${config.get('refreshToken', '')}`, {
        method: 'POST',
    })
        .then((r) => r.json())
        .then((r) => {
            if (r.access_token && r.refresh_token) {
                config.set('twitchToken', r.access_token);
                config.set('refreshToken', r.refresh_token);
                twitchToken = r.access_token;
                getUserIsLive();
            } else {
                log.error('Twitch API: Could not refresh token');
            }
        })
        .catch((err) => log.error('Twitch API:', err));
};

const twitchLogin = () => {
    if (twitchToken) {
        getUserIsLive();
        setInterval(refreshTwitchToken, 7 * 24 * 60 * 60 * 1000); // Refresh token weekly
        initTwitchChat();
    }
};

app.on('ready', initSplashWindow);
app.on('window-all-closed', () => app.quit());

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) initSplashWindow();
});

ipcMain.handle('showOpenDialog', async () => {
    return dialog.showOpenDialogSync({
        properties: ['openFile', 'openDirectory', 'multiSelections'],
    });
});
