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
  type Source = { title?: string; url?: string };
  type ArgumentItem = { claim?: string; summary?: string; sources?: Source[]; replies?: ArgumentItem[] };

  const [proArgs, setProArgs] = useState<ArgumentItem[]>([]);
  const [conArgs, setConArgs] = useState<ArgumentItem[]>([]);
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
        // keep the input value so the user can edit or submit again
      }
    } catch (err) {
      console.error("Request failed:", err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const clearDebate = () => {
    setValue('');
    setProArgs([]);
    setConArgs([]);
    setTopicState(null);
    setError(null);
    setLoading(false);
  };

  function updateNestedInsert(arr: ArgumentItem[], path: number[], itemsToAppend: ArgumentItem[]): ArgumentItem[] {
    if (!path || path.length === 0) return arr;
    const idx = path[0];
    const rest = path.slice(1);
    return arr.map((it: ArgumentItem, i: number) => {
      if (i !== idx) return it;
      if (rest.length === 0) {
        const replies = Array.isArray(it.replies) ? it.replies.slice() : [];
        return { ...it, replies: replies.concat(itemsToAppend) };
      }
      const nextReplies = Array.isArray(it.replies) ? it.replies : [];
      return { ...it, replies: updateNestedInsert(nextReplies, rest, itemsToAppend) };
    });
  }

  function getNodeFromPath(arr: ArgumentItem[], path: number[]): ArgumentItem | undefined {
    if (!path || path.length === 0) return undefined;
    let node: ArgumentItem | undefined = arr[path[0]];
    for (let i = 1; i < path.length; i++) {
      node = node?.replies?.[path[i]];
      if (!node) return undefined;
    }
    return node;
  }

  const handleCounter = async (side: 'pro' | 'con', path: number[], claim: string, rootSide?: 'pro' | 'con') => {
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

      const generated = (side === 'pro' ? (data.con || []) : (data.pro || [])) as ArgumentItem[];
      if (!generated || generated.length === 0) return;

      // Insert generated replies into the array that owns the targeted item (rootSide)
      const targetRoot = rootSide || side;
      if (targetRoot === 'pro') {
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

  type ArgumentCardProps = { item: ArgumentItem; side: 'pro' | 'con'; path?: number[]; rootSide?: 'pro' | 'con' };
  function ArgumentCard({ item, side, path = [], rootSide }: ArgumentCardProps) {
    return (
      <View style={{ marginTop: 8 }}>
        <View style={[styles.card, side === 'pro' ? styles.proCard : styles.conCard]}>
          <Text style={[styles.claim, side === 'pro' ? styles.proClaim : styles.conClaim]}>{item.claim || 'Claim'}</Text>
          <Text style={[styles.summary, side === 'pro' ? styles.proSummary : styles.conSummary]}>{item.summary || ''}</Text>
          {(item.sources || []).map((s: any, j: number) => (
            <TouchableOpacity key={`src-${j}`} onPress={() => s.url && Linking.openURL(s.url)}>
              <Text style={[styles.sourceLink, side === 'pro' ? styles.proSource : styles.conSource]}>{s.title || s.url || 'source'}</Text>
            </TouchableOpacity>
          ))}

          
        </View>

        {(item.replies || []).map((r: ArgumentItem, ri: number) => (
          <View key={`reply-${ri}`} style={styles.replyWrap}>
            <ArgumentCard item={r} side={side === 'pro' ? 'con' : 'pro'} path={path.concat(ri)} rootSide={rootSide} />
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
      {(value.trim() !== '' || proArgs.length > 0 || conArgs.length > 0) && (
        <View style={{ width: '80%', maxWidth: 600, alignItems: 'flex-end' }}>
          <TouchableOpacity style={styles.clearButton} onPress={clearDebate} accessibilityRole="button">
            <Text style={styles.clearButtonText}>Clear Debate</Text>
          </TouchableOpacity>
        </View>
      )}
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
                  {proArgs.map((a: ArgumentItem, i: number) => (
                    <ArgumentCard key={`pro-${i}`} item={a} side="pro" path={[i]} rootSide="pro" />
                  ))}

                  {proArgs.length > 0 && (
                    <View style={{ paddingVertical: 8 }}>
                      <TouchableOpacity
                        style={styles.counterButton}
                        onPress={() => {
                          // find deepest path within the latest pro thread
                          const getDeepestPath = (arr: any[], idx: number) => {
                            const path = [idx];
                            let node = arr[idx];
                            while (node && Array.isArray(node.replies) && node.replies.length > 0) {
                              const last = node.replies.length - 1;
                              path.push(last);
                              node = node.replies[last];
                            }
                            return path;
                          };
                          const idx = proArgs.length - 1;
                          const path = getDeepestPath(proArgs, idx);
                          const lastNode = getNodeFromPath(proArgs, path);
                          const claim = lastNode?.claim || proArgs[idx]?.claim || '';
                          handleCounter('pro', path, claim, 'pro');
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
                {conArgs.map((a: ArgumentItem, i: number) => (
                  <ArgumentCard key={`con-${i}`} item={a} side="con" path={[i]} rootSide="con" />
                ))}

                {conArgs.length > 0 && (
                  <View style={{ paddingVertical: 8 }}>
                    <TouchableOpacity
                      style={styles.counterButton}
                      onPress={() => {
                        const getDeepestPath = (arr: any[], idx: number) => {
                          const path = [idx];
                          let node = arr[idx];
                          while (node && Array.isArray(node.replies) && node.replies.length > 0) {
                            const last = node.replies.length - 1;
                            path.push(last);
                            node = node.replies[last];
                          }
                          return path;
                        };
                        const idx = conArgs.length - 1;
                        const path = getDeepestPath(conArgs, idx);
                        const lastNode = getNodeFromPath(conArgs, path);
                        const claim = lastNode?.claim || conArgs[idx]?.claim || '';
                        handleCounter('con', path, claim, 'con');
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
    flex: 1,
    minWidth: 120,
    padding: 12,
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
    flexShrink: 0,
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
  proCard: {
    backgroundColor: '#7C3AED',
    borderColor: '#6D28D9',
  },
  proClaim: {
    color: '#fff',
  },
  proSummary: {
    color: '#F3E8FF',
  },
  proSource: {
    color: '#E9D5FF',
    textDecorationLine: 'underline',
  },
  conCard: {
    backgroundColor: '#F97316',
    borderColor: '#EA580C',
  },
  conClaim: {
    color: '#071327',
  },
  conSummary: {
    color: '#0F172A',
  },
  conSource: {
    color: '#1D4ED8',
    textDecorationLine: 'underline',
  },
  clearButton: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 8,
  },
  clearButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
});
