# Android APK and push setup

This track is separate from the staging web-approval drill. No paid service is required for account setup; do not select a paid plan for this task.

## Your setup checklist

- [ ] Create an account at https://expo.dev/signup and verify your email.
- [ ] Create a Rook staging project in Expo. Record its project URL and project ID (not an access token).
- [ ] Sign into https://console.firebase.google.com/ with your Google account and create a Rook staging project. Analytics is optional.
- [ ] Register an Android app in that Firebase project. For the existing Rook build, the package name is `com.app.rook`.
- [ ] Download its `google-services.json` into a local folder outside the repository. Tell Codex the file path; do not paste credentials into chat.
- [ ] Follow Expo's FCM instructions to configure the Firebase service account for push delivery in the Expo project. Keep the private service-account JSON outside Git and upload it only to your Expo project's credentials settings.
- [ ] Return with the Expo project URL, local Google services config path, and confirmation that FCM credentials are configured.

## Work Codex will finish afterward

- [ ] Configure the native build with the Expo project ID and Google services file.
- [ ] Set a verified staging API URL explicitly for the build.
- [ ] Use a persistent Android signing key so updates remain installable. The current workflow generates a different key per run; do not uninstall an existing app without checking local data first.
- [ ] Build and verify an APK containing the background-job approval screen, with a checksum and a usable download link. The current workflow uploads a temporary Actions artifact; the latest public release has no APK.
- [ ] Install on your Android phone, sign in, open **Library → Privacy**, enable **Approval alerts** and **Completion alerts**, then tap **Enable alerts** and allow notifications.
- [ ] Verify device registration in the staging database, actual Expo delivery receipts, notification tap routing, approval, and the final result.

References: [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/), [Android FCM credentials](https://docs.expo.dev/push-notifications/fcm-credentials/).

The InstantDB admin token stays on the server. It must never enter the APK or any `EXPO_PUBLIC_*` variable.
