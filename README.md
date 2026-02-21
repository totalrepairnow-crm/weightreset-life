# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Coach STT over LAN (Android físico)

1. Obtener IP LAN del host (Mac):

   ```bash
   ipconfig getifaddr en0 || ipconfig getifaddr en1
   ```

2. Configurar variables:

   Root Expo (`/Users/smith/weightreset-life/.env`):

   ```bash
   EXPO_PUBLIC_AI_BASE_URL=http://TU_IP_LAN:3000
   ```

   Backend (`/Users/smith/weightreset-life/weightreset-ai/.env.local`):

   ```bash
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4.1-mini
   ```

3. Correr backend:

   ```bash
   cd weightreset-ai
   npm run dev -- --hostname 0.0.0.0 --port 3000
   ```

4. Correr app Expo (en otra terminal):

   ```bash
   npm start
   ```

5. Probar transcribe end-to-end con audio real:

   Generar WAV de prueba (macOS):

   ```bash
   say -o /tmp/wr-stt.aiff "hola esta es una prueba de transcripcion"
   afconvert -f WAVE -d LEI16 /tmp/wr-stt.aiff /tmp/wr-stt.wav
   ```

   Probar endpoint:

   ```bash
   curl -F "file=@/tmp/wr-stt.wav;type=audio/wav" http://TU_IP_LAN:3000/api/voice/transcribe
   ```

   Debe responder `200` y `data.text`.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
