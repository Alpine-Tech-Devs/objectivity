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
  const [topicState, setTopicState] = useState<string | null>(null);
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
        setTopicState(topic);
        setValue("");
      }
    } catch (err) {
      console.error("Request failed:", err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  function updateNestedInsert(arr, path, itemsToAppend) {
    if (!path || path.length === 0) return arr;
    const idx = path[0];
    const rest = path.slice(1);
    return arr.map((it, i) => {
      if (i !== idx) return it;
      if (rest.length === 0) {
        const replies = Array.isArray(it.replies) ? it.replies.slice() : [];
        return { ...it, replies: replies.concat(itemsToAppend) };
      }
      const nextReplies = Array.isArray(it.replies) ? it.replies : [];
      return { ...it, replies: updateNestedInsert(nextReplies, rest, itemsToAppend) };
    });
  }

  const handleCounter = async (side: 'pro' | 'con', path: number[], claim: string) => {
    if (!topicState) {
      setError('No active topic. Submit a topic first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('http://localhost:4200/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topicState,
          targetClaim: claim,
          targetSide: side,
          history: { pro: proArgs, con: conArgs },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Request failed');
        return;
      }

      const generated = (side === 'pro' ? data.con || [] : data.pro || []);
      if (!generated || generated.length === 0) return;

      if (side === 'pro') {
        setProArgs(prev => updateNestedInsert(prev, path, generated));
      } else {
        setConArgs(prev => updateNestedInsert(prev, path, generated));
      }
    } catch (err) {
      console.error('Counter request failed:', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  function ArgumentCard({ item, side, path = [] }: any) {
    return (
      <View style={{ marginTop: 8 }}>
        <View style={styles.card}>
          <Text style={styles.claim}>{item.claim || 'Claim'}</Text>
          <Text style={styles.summary}>{item.summary || ''}</Text>
          {(item.sources || []).map((s: any, j: number) => (
            <TouchableOpacity key={`src-${j}`} onPress={() => s.url && Linking.openURL(s.url)}>
              <Text style={styles.sourceLink}>{s.title || s.url || 'source'}</Text>
            </TouchableOpacity>
          ))}

          
        </View>

        {(item.replies || []).map((r: any, ri: number) => (
          <View key={`reply-${ri}`} style={styles.replyWrap}>
            <ArgumentCard item={r} side={side === 'pro' ? 'con' : 'pro'} path={path.concat(ri)} />
          </View>
        ))}
      </View>
    );
  }

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
                    <ArgumentCard key={`pro-${i}`} item={a} side="pro" path={[i]} />
                  ))}

                  {proArgs.length > 0 && (
                    <View style={{ paddingVertical: 8 }}>
                      <TouchableOpacity
                        style={styles.counterButton}
                        onPress={() => {
                          const idx = proArgs.length - 1;
                          const claim = proArgs[idx]?.claim || '';
                          handleCounter('pro', [idx], claim);
                        }}
                        accessibilityRole="button"
                      >
                        <Text style={styles.counterButtonText}>Counterargument</Text>
                      </TouchableOpacity>
                    </View>
                  )}
            </ScrollView>
          </View>

          <View style={[styles.column, { width: isWide ? '48%' : '100%', marginTop: isWide ? 0 : 12 }]}>
            <Text style={styles.columnTitle}>Con</Text>
            <ScrollView style={styles.columnScroll}>
                {conArgs.map((a: any, i: number) => (
                  <ArgumentCard key={`con-${i}`} item={a} side="con" path={[i]} />
                ))}

                {conArgs.length > 0 && (
                  <View style={{ paddingVertical: 8 }}>
                    <TouchableOpacity
                      style={styles.counterButton}
                      onPress={() => {
                        const idx = conArgs.length - 1;
                        const claim = conArgs[idx]?.claim || '';
                        handleCounter('con', [idx], claim);
                      }}
                      accessibilityRole="button"
                    >
                      <Text style={styles.counterButtonText}>Counterargument</Text>
                    </TouchableOpacity>
                  </View>
                )}
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
  counterButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#111827',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  counterButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  replyWrap: {
    marginLeft: 14,
    borderLeftWidth: 2,
    borderLeftColor: '#f3f4f6',
    paddingLeft: 10,
  },
});
