
const fs = require("fs");
const path = require("path");

const { initializeApp, cert, getApps } =
    require("firebase-admin/app");

const { getFirestore } =
    require("firebase-admin/firestore");

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(
        process.env.FIREBASE_SERVICE_ACCOUNT
    );
} else {
    const keyPath = path.join(
        __dirname,
        "firebase-service-account.json"
    );

    if (!fs.existsSync(keyPath)) {
        throw new Error(
            "Firebase kalit fayli topilmadi!"
        );
    }

    serviceAccount = require(keyPath);
}

if (serviceAccount.private_key) {
    serviceAccount.private_key =
        serviceAccount.private_key.replace(/\\n/g, "\n");
}

const app = getApps().length
    ? getApps()[0]
    : initializeApp({
        credential: cert(serviceAccount)
    });

const db = getFirestore(app);

console.log("🔥 Firebase Firestore ulandi!");

module.exports = { db };
