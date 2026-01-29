import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";

export default function HomeScreen() {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [proArgs, setProArgs] = useState([]);
  const [conArgs, setConArgs] = useState([]);
  const [error, setError] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const isWide = width >= 600;

  const handleSubmit = async () => {
    if (!value.trim()) return;

    const topic = value.trim();
    if (!topic) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("http://localhost:4200/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });

      const data = await res.json();
      console.log('api/chat response', data);
      if (!res.ok) {
        setError(data?.error || 'Request failed');
        setProArgs([]);
        setConArgs([]);
      } else {
        setProArgs(data.pro || []);
        setConArgs(data.con || []);
        setValue("");
      }
    } catch (err) {
      console.error("Request failed:", err);
      setError(String(err));
    } finally {
      setLoading(false);
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
      <View style={styles.inputContainer}>
        <TextInput
          value={value}
          onChangeText={setValue}
          onSubmitEditing={handleSubmit}
          placeholder="Enter a topic to explore both sides"
          style={styles.input}
          returnKeyType="done"
          autoFocus
          placeholderTextColor="#9CA3AF"
        />
        <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} accessibilityRole="button">
          <Text style={styles.submitButtonText}>Debate</Text>
        </TouchableOpacity>
      </View>
      {loading && (
        <View style={{ paddingVertical: 12 }}>
          <ActivityIndicator size="small" />
        </View>
      )}
      {error ? <Text style={{ color: 'red', marginTop: 8 }}>{error}</Text> : null}

      {(proArgs.length > 0 || conArgs.length > 0) && (
        <View style={[styles.resultsContainer, { flexDirection: isWide ? 'row' : 'column' }]}>
          <View style={[styles.column, { width: isWide ? '48%' : '100%' }]}>
            <Text style={styles.columnTitle}>Pro</Text>
            <ScrollView style={styles.columnScroll}>
              {proArgs.map((a: any, i: number) => (
                <View key={`pro-${i}`} style={styles.card}>
                  <Text style={styles.claim}>{a.claim || `Argument ${i + 1}`}</Text>
                  <Text style={styles.summary}>{a.summary || ''}</Text>
                  {(a.sources || []).map((s: any, j: number) => (
                    <TouchableOpacity key={`pro-src-${j}`} onPress={() => s.url && Linking.openURL(s.url)}>
                      <Text style={styles.sourceLink}>{s.title || s.url || 'source'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>

          <View style={[styles.column, { width: isWide ? '48%' : '100%', marginTop: isWide ? 0 : 12 }]}>
            <Text style={styles.columnTitle}>Con</Text>
            <ScrollView style={styles.columnScroll}>
              {conArgs.map((a: any, i: number) => (
                <View key={`con-${i}`} style={styles.card}>
                  <Text style={styles.claim}>{a.claim || `Argument ${i + 1}`}</Text>
                  <Text style={styles.summary}>{a.summary || ''}</Text>
                  {(a.sources || []).map((s: any, j: number) => (
                    <TouchableOpacity key={`con-src-${j}`} onPress={() => s.url && Linking.openURL(s.url)}>
                      <Text style={styles.sourceLink}>{s.title || s.url || 'source'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      )}
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
  resultsContainer: {
    flexDirection: "row",
    width: "100%",
    paddingHorizontal: 16,
    marginTop: 12,
    justifyContent: "space-between",
  },
  column: {
    width: "48%",
  },
  columnTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  columnScroll: {
    maxHeight: 300,
  },
  claim: {
    fontWeight: '700',
    marginBottom: 6,
  },
  summary: {
    marginBottom: 6,
  },
  sourceLink: {
    color: '#2563eb',
    textDecorationLine: 'underline',
    marginBottom: 4,
  },
  inputContainer: {
    width: '80%',
    maxWidth: 600,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  submitButton: {
    marginLeft: 8,
    backgroundColor: '#111827',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  submitButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  card: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eee',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
  },
});
