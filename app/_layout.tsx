import React from "react";
import { Stack } from "expo-router";
import { View, Text, StyleSheet } from "react-native";

function Footer() {
  const year = new Date().getFullYear();
  return (
    <View style={styles.footer}>
      <Text style={styles.text}>© {year} The Objectivity - All Rights Reserved</Text>
    </View>
  );
}

export default function RootLayout() {
  return (
    <View style={styles.container}>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
      <Footer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  footer: {
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e6e6e6",
    backgroundColor: "transparent",
  },
  text: {
    fontSize: 12,
    color: "#666",
  },
});
