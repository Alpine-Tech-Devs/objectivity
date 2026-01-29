import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";

export default function HomeScreen() {
  const [value, setValue] = useState("");

  const handleSubmit = async () => {
    if (!value.trim()) return;

    try {
      const res = await fetch("http://localhost:4200/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: value }),
      });

      const data = await res.json();
      console.log("OpenAI response:", data);

      setValue("");
    } catch (err) {
      console.error("Request failed:", err);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.quoteWrap}>
        <Text style={styles.quote}>
          "There is no such thing as objectivity. The best you can do is hear both sides argued well, and decide for yourself."
        </Text>
      </View>
      <TextInput
        value={value}
        onChangeText={setValue}
        onSubmitEditing={handleSubmit}
        placeholder="Type something…"
        style={styles.input}
        returnKeyType="done"
        autoFocus
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  input: {
    width: "80%",
    maxWidth: 400,
    padding: 14,
    borderWidth: 1,
    borderRadius: 8,
    fontSize: 16,
  },
  quoteWrap: {
    width: "80%",
    maxWidth: 600,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  quote: {
    textAlign: "center",
    fontSize: 15,
    fontStyle: "italic",
    color: "#333",
  },
});
