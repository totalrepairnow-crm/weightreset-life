# CLAUDE.md

## 1) Descripción general del proyecto

**WeightReset Life** es una app móvil (Expo/React Native) enfocada en hábitos de nutrición y bienestar, con un backend AI separado (`weightreset-ai`) para análisis de imágenes de comida, transcripción de voz y coaching conversacional.

### Stack tecnológico completo

- Frontend móvil: Expo SDK 54, React Native 0.81, React 19, Expo Router.
- Lenguaje: TypeScript (modo `strict`).
- Navegación: `expo-router` con rutas por archivos y tabs en `app/(tabs)`.
- Estado/persistencia local: `@react-native-async-storage/async-storage`.
- Capacidades nativas:
  - Cámara y scanner: `expo-camera`
  - Selección/captura de imágenes: `expo-image-picker`
  - Audio grabación (STT input): `expo-av`
  - Voz sintetizada (TTS): `expo-speech`
  - Notificaciones: `expo-notifications`
- Backend AI: Next.js 16 (App Router), Node runtime, OpenAI SDK.
- Integración nutricional adicional: Open Food Facts (lookup de barcode).

## 2) Arquitectura de módulos

### Módulo A: Análisis de fotos / etiquetas de comida

- UI principal: `app/(tabs)/comidas.tsx`
- Modelo y almacenamiento: `lib/food.ts`
- Endpoint backend: `weightreset-ai/app/api/food/analyze/route.ts`
- Flujo:
  1. Usuario toma/elige foto (`expo-image-picker`) de comida o etiqueta.
  2. La app envía `imageBase64 + mimeType + context` a `POST /api/food/analyze`.
  3. Backend analiza con OpenAI y retorna JSON de items + macros.
  4. Frontend guarda `MealEntry` en AsyncStorage (`wr_meals_v1_<date>`).
  5. Si falla AI, hay fallback local (`analyzeMealMock`).

### Módulo B: Escaneo de código de barras

- Scanner: `app/barcode-scan.tsx` (`expo-camera`).
- Consumo/guardado: `app/(tabs)/comidas.tsx` + `lib/food.ts`.
- Integración externa: Open Food Facts en `lib/food.ts` (`analyzeBarcodeOpenFoodFacts`).
- Flujo:
  1. Scanner lee UPC/EAN.
  2. Navega de vuelta a `/(tabs)/comidas` con `scannedBarcode`.
  3. App consulta Open Food Facts y genera análisis nutricional.
  4. Guarda comida del día en AsyncStorage.
  5. Si Open Food Facts falla, fallback a análisis mock local.

### Módulo C: Coach AI (chat + voz)

- UI principal: `app/(tabs)/coach.tsx`.
- Endpoints backend:
  - `POST /api/coach/chat`
  - `POST /api/voice/transcribe`
- Capacidades:
  - Chat contextual con historial.
  - STT (grabar audio y transcribir a texto).
  - TTS (leer respuestas del coach).
  - Plan diario/checklist persistidos en AsyncStorage.
- Resolución de backend:
  - Usa `EXPO_PUBLIC_AI_BASE_URL` y override guardado en `wr_ai_base_url_v1`.
  - Para Android físico evita `localhost` y prioriza URL LAN alcanzable.

### Cómo se conectan entre sí

- `perfil`, `registrar`, `progreso`, `comidas` y `coach` comparten contexto vía AsyncStorage (`wr_mode_v1`, `wr_profile_v1`, checkins y comidas por fecha).
- `coach` consume el resumen nutricional diario generado por `comidas`.
- `plan` y `coach` comparten concepto de “plan del día” con almacenamiento local.

## 3) Integraciones externas actuales (OpenAI)

### 3.1 `POST /api/food/analyze`

- Archivo: `weightreset-ai/app/api/food/analyze/route.ts`
- SDK/API OpenAI usado: `client.responses.create(...)`
- Modelo: `process.env.OPENAI_MODEL || "gpt-4.1-mini"`
- Función exacta: analizar imagen de comida/etiqueta y devolver JSON estructurado con items, totales y notas.

### 3.2 `POST /api/coach/chat`

- Archivo: `weightreset-ai/app/api/coach/chat/route.js`
- SDK/API OpenAI usado: `client.chat.completions.create(...)`
- Modelo: `"gpt-4.1-mini"` (hardcoded en la ruta)
- Función exacta:
  - Respuesta conversacional de coach.
  - Detección de intención `plan` y retorno JSON de plan cuando aplica.
  - Personalización por modo, perfil e historial.

### 3.3 `POST /api/voice/transcribe`

- Archivo: `weightreset-ai/app/api/voice/transcribe/route.js`
- SDK/API OpenAI usado: `client.audio.transcriptions.create(...)`
- Modelo: `"whisper-1"`
- Función exacta: recibir audio multipart (campo `file` y compatibles), validar tipo/tamaño y devolver transcripción.

## 4) Variables de entorno necesarias (sin valores)

### Frontend (root Expo app)

- `EXPO_PUBLIC_AI_BASE_URL`
- `EXPO_PUBLIC_AI_URL` (legacy, todavía usado por `comidas.tsx`)

### Backend (`weightreset-ai`)

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (opcional, con default en código)

## 5) Comandos de desarrollo

### Root (Expo app)

- `npm install`
- `npm run start`
- `npm run android`
- `npm run ios`
- `npm run web`
- `npm run lint`
- `npx tsc --noEmit` (typecheck manual, no script dedicado)

### Backend (`weightreset-ai`)

- `cd weightreset-ai`
- `npm install`
- `npm run dev`
- `npm run dev -- --hostname 0.0.0.0 --port 3000` (LAN en Android físico)
- `npm run lint`
- `npm run build`
- `npx tsc --noEmit` (typecheck manual)

### Tests

- Actualmente no hay scripts de tests automatizados (`test`) en ninguno de los dos `package.json`.

## 6) Convenciones de código observadas

- TypeScript en `strict` (frontend y backend TS config strict).
- Ruteo por archivos con Expo Router (`app/(tabs)`).
- Uso extensivo de AsyncStorage con llaves versionadas `wr_*_v1`.
- UI orientada a tema centralizado (`theme/theme.ts`) con fallbacks de color defensivos.
- Endpoints backend retornan JSON consistente con forma `{ ok, data?, error? }`.
- Patrón defensivo para módulos nativos opcionales (`require(...)` en `try/catch` para `expo-av` y `expo-speech`).
- Mensajería UX en español (principalmente es-MX).

## 7) Qué está en progreso / incompleto actualmente

- Tabs placeholder:
  - `app/(tabs)/insights.tsx`
  - `app/(tabs)/calendario.tsx`
  - `app/(tabs)/logros.tsx`
  Estas pantallas aún muestran “Próximamente”.
- `weightreset-ai/app/page.tsx` sigue con template default de Next.js (no landing/productización).
- `app/(tabs)/comidas.tsx` depende de `EXPO_PUBLIC_AI_URL` (legacy) y trae fallback hardcoded a IP LAN concreta (`192.168.1.243:3000`).
- En flujo de comidas y barcode existen fallbacks mock si falla integración remota.
- No hay suite de tests automatizados (unit/integration/e2e) declarada.

## 8.1) Contexto del producto

- **Nombre:** WeightReset Life
- **Idioma UX:** español México (es-MX)
- **Tono del coach:** motivador, directo, personalizado por modo (pérdida de peso / mantenimiento / ganancia muscular)
- **Usuarios objetivo:** adultos hispanohablantes en proceso de cambio de hábitos alimenticios
- **Plataformas destino:** iOS y Android (Expo managed workflow)

## 8.2) Nota de migración AI (OpenAI → Claude)

| Módulo | Endpoint | Decisión | Razón |
|---|---|---|---|
| Análisis de fotos | `/api/food/analyze` | ✅ Candidato a migrar → `claude-sonnet-4-6` | Visión + JSON estructurado, mejor costo |
| Coach conversacional | `/api/coach/chat` | ✅ Candidato a migrar → `claude-haiku-4-5` | Conversación fluida, ~80% más barato |
| Transcripción de voz | `/api/voice/transcribe` | ❌ MANTENER en OpenAI `whisper-1` | Claude no tiene modelo de audio/STT |

**Modelo actual real:** `gpt-4.1-mini` (no GPT-4 Turbo). Tener en cuenta para comparativas de costo.

**Estrategia de migración sugerida:**
1. Primero migrar `/api/coach/chat` → Claude Haiku 4.5 (menor riesgo, mayor ahorro)
2. Luego migrar `/api/food/analyze` → Claude Sonnet 4.6 (requiere validar calidad de visión)
3. Mantener Whisper indefinidamente para transcripción de voz

## 9) Qué NO tocar sin consultarme primero

- Contratos de API ya consumidos por app:
  - `/api/food/analyze`
  - `/api/coach/chat`
  - `/api/voice/transcribe`
  (shape de request/response y campos JSON)
- Llaves y estructura de AsyncStorage `wr_*_v1` (son acoplamientos entre tabs).
- Resolución de base URL LAN del Coach (`EXPO_PUBLIC_AI_BASE_URL` + override `wr_ai_base_url_v1`), porque impacta Android físico.
- Configuración nativa de audio/red en `app.json` (permisos de micrófono y `usesCleartextTraffic`).
- Nombres/rutas de tabs en Expo Router (impactan navegación y deep links).

