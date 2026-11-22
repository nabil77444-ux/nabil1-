interface TaibahCapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  server?: { androidScheme?: string; cleartext?: boolean };
  plugins?: Record<string, Record<string, unknown>>;
  android?: Record<string, unknown>;
}

const config: TaibahCapacitorConfig = {
  appId: 'net.taibah.wireless',
  appName: 'كروت طيبة نت',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#0F172A',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
