// Hayce config — Firebase + App Check + Google Places
const IS_LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

export const CONFIG = {
  siteName: "Hayce",
  baseUrl: IS_LOCAL ? "http://localhost:5173" : "https://hayce-apps.com",

  provider: "firebase",           // 'firebase' | 'form'
  formEndpoint: "",
  formEncoding: "json",

  firebase: {
    // IMPORTANT: this is your Firebase Web apiKey (keep the original, not the Maps key)
    apiKey: "AIzaSyAqbpzpFSMrUyw89e7IZabMQSMRVACn4kk",
    authDomain: "hg-1-2b031.firebaseapp.com",
    projectId: "hg-1-2b031",
    appId: "1:758436345529:web:e2326c13329e7a83b3cd68",
    messagingSenderId: "758436345529",
    storageBucket: "hg-1-2b031.appspot.com",
    databaseURL: "https://hg-1-2b031-default-rtdb.firebaseio.com",
    measurementId: "G-G1B94FBQ23",
    collection: "waitlist"
  },

  // App Check (reCAPTCHA Enterprise)
  appCheck: {
    provider: "recaptchaEnterprise",
    siteKey: "6LeTKQksAAAAAO8iawQTq2pk9Y7teN_DsREWzCir",
    debug: IS_LOCAL // only on localhost
  },

  // Google Places Autocomplete — injected at deploy, never committed
  googleMaps: {
    apiKey: "${MAPS_API_KEY}",
    allowedCountries: ["CA","US","NG"]
  },

  enableAnalytics: false,
  analyticsProvider: "ga4",
  analyticsDomain: "hayce-apps.com",
  gaMeasurementId: "G-G1B94FBQ23"
};
