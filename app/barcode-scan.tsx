import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function BarcodeScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);

  const params = useLocalSearchParams<{ returnPath?: string | string[] }>();
  const returnPath = useMemo(() => {
    const raw = params.returnPath;
    const p = Array.isArray(raw) ? raw[0] : raw;
    return p && typeof p === 'string' ? p : '/(tabs)/comidas';
  }, [params.returnPath]);

  const onBarcodeScanned = useCallback(
    (result: any) => {
      if (scanned) return;
      const data = String(result?.data ?? '').trim();
      if (!data) return;

      setScanned(true);

      router.replace({
        pathname: returnPath as any,
        params: { scannedBarcode: data },
      });
    },
    [scanned, returnPath]
  );

  if (!permission) {
    return <View style={{ flex: 1, backgroundColor: 'black' }} />;
  }

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: 'black', justifyContent: 'center', padding: 20 }}>
        <Text style={{ color: 'white', fontSize: 22, fontWeight: '900', textAlign: 'center' }}>
          Permiso de cámara
        </Text>
        <Text style={{ color: 'white', opacity: 0.85, marginTop: 10, textAlign: 'center' }}>
          Necesitamos cámara para escanear barcodes.
        </Text>

        <Pressable
          onPress={() => requestPermission()}
          style={{ marginTop: 18, backgroundColor: '#FF6A00', padding: 14, borderRadius: 14 }}
        >
          <Text style={{ color: 'white', fontWeight: '900', textAlign: 'center' }}>
            Permitir cámara
          </Text>
        </Pressable>

        <Pressable onPress={() => router.back()} style={{ marginTop: 10, padding: 14 }}>
          <Text style={{ color: 'white', fontWeight: '900', textAlign: 'center' }}>Cancelar</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: 'black' }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        enableTorch={torchEnabled as any}
        barcodeScannerSettings={{
          barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'],
        }}
        onBarcodeScanned={onBarcodeScanned}
      />

      {/* Overlay */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          paddingTop: 18,
          paddingHorizontal: 16,
          backgroundColor: 'rgba(0,0,0,0.35)',
        }}
      >
        <Text style={{ color: 'white', fontSize: 18, fontWeight: '900' }}>
          Escanea un UPC / Barcode
        </Text>
        <Text style={{ color: 'white', opacity: 0.9, marginTop: 6 }}>
          Apunta al código. Se guardará automáticamente. Si ya escaneó, toca &quot;Escanear otro&quot;.
        </Text>
      </View>

      <View
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 86,
          flexDirection: 'row',
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => setTorchEnabled((v) => !v)}
          style={{
            flex: 1,
            backgroundColor: 'rgba(255,255,255,0.92)',
            padding: 14,
            borderRadius: 14,
          }}
        >
          <Text style={{ textAlign: 'center', fontWeight: '900' }}>
            {torchEnabled ? '🔦 Linterna: ON' : '🔦 Linterna: OFF'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setScanned(false)}
          disabled={!scanned}
          style={{
            flex: 1,
            backgroundColor: scanned ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.55)',
            padding: 14,
            borderRadius: 14,
          }}
        >
          <Text style={{ textAlign: 'center', fontWeight: '900' }}>🔄 Escanear otro</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={() => router.back()}
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 18,
          backgroundColor: 'rgba(255,255,255,0.92)',
          padding: 14,
          borderRadius: 14,
        }}
      >
        <Text style={{ textAlign: 'center', fontWeight: '900' }}>Cancelar</Text>
      </Pressable>
    </View>
  );
}
