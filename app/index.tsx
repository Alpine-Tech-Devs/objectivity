import { LinearGradient } from "expo-linear-gradient";
import React, { useState, useMemo } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";

type Source = { title?: string; url?: string };
type ArgumentItem = {
  claim?: string;
  summary?: string;
  sources?: Source[];
  replies?: ArgumentItem[];
  detail?: Detail;
};
type Detail = { claim?: string; long_summary?: string; sources?: Source[] };

export default function HomeScreen() {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [proArgs, setProArgs] = useState<ArgumentItem[]>([]);
  const [conArgs, setConArgs] = useState<ArgumentItem[]>([]);
  const [topicState, setTopicState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hideInputOnMobile, setHideInputOnMobile] = useState(false);
  const [loadingButtonPath, setLoadingButtonPath] = useState<string | null>(null);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [threadViewPath, setThreadViewPath] = useState<{ side: 'pro' | 'con', path: number[], rootSide: 'pro' | 'con' } | null>(null);
  
  const openThreadView = (side: 'pro' | 'con', path: number[], rootSide?: 'pro' | 'con') => {
    setThreadViewPath({ side, path, rootSide: rootSide || side });
  };
  
  const closeThreadView = () => {
    setThreadViewPath(null);
  };
  
  const navigateThreadPath = (side: 'pro' | 'con', path: number[], rootSide?: 'pro' | 'con') => {
    setThreadViewPath({ side, path, rootSide: rootSide || side });
  };
  
  const getCollapseKey = (side: 'pro' | 'con', path: number[]) => {
    return `${side}-${path.join('-')}`;
  };
  
  const toggleCollapse = (side: 'pro' | 'con', path: number[]) => {
    const key = getCollapseKey(side, path);
    setCollapsedPaths(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };
  
  const getPathKey = (side: 'pro' | 'con', path: number[], action: 'counter' | 'dive') => {
    return `${side}-${path.join('-')}-${action}`;
  };

  const getArgumentAtPath = (side: 'pro' | 'con', path: number[]): ArgumentItem | undefined => {
    const arr = side === 'pro' ? proArgs : conArgs;
    let current: ArgumentItem | undefined = arr[path[0]];
    for (let i = 1; i < path.length; i++) {
      current = current?.replies?.[path[i]];
    }
    return current;
  };
  const { width, height } = useWindowDimensions();
  const isWide = width >= 600;
  const isWeb = Platform.OS === "web";
  const isSmallScreen = width < 400;
  const isLandscape = height < width;
  // base URL for the backend API.
  // - In deployed web builds, use relative paths (empty string) so `/api/*` proxies to Netlify Functions.
  // - In local web development when running on localhost, keep the explicit localhost:4200 host.
  // - On native (Expo) devices, attempt to use the LAN host for the dev server.
  const apiBase = (() => {
    // Web: use relative paths except when running on localhost (developer machine)
    if (Platform.OS === 'web') {
      try {
        const host = (typeof window !== 'undefined' && window.location && window.location.hostname) || '';
        if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:4200';
        return '';
      } catch (e) {
        return '';
      }
    }

    // Native / Expo: try to compute LAN host from Expo Constants for physical device testing
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Constants = require('expo-constants');
      const host = (Constants?.manifest?.debuggerHost || '').split(':')[0];
      if (host) return `http://${host}:4200`;
    } catch (e) {
      // ignore and fall back to localhost
    }

    return 'http://localhost:4200';
  })();

  const handleSubmit = async () => {
    if (!value.trim()) return;

    const topic = value.trim();
    if (!topic) return;
    setLoading(true);
    setError(null);
    setThreadViewPath(null);
    try {
      const res = await fetch(`${apiBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });

      const data = await res.json();
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
    setThreadViewPath(null);
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

  function updateNestedSetDetail(arr: ArgumentItem[], path: number[], detail: Detail): ArgumentItem[] {
    if (!path || path.length === 0) return arr;
    const idx = path[0];
    const rest = path.slice(1);
    return arr.map((it: ArgumentItem, i: number) => {
      if (i !== idx) return it;
      if (rest.length === 0) {
        return { ...it, detail };
      }
      const nextReplies = Array.isArray(it.replies) ? it.replies : [];
      return { ...it, replies: updateNestedSetDetail(nextReplies, rest, detail) };
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
    setLoadingButtonPath(getPathKey(side, path, 'counter'));
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/chat`, {
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
      
      if (!generated || generated.length === 0) {
        setError('No counterarguments generated. Please try again.');
        return;
      }

      // Auto-expand the replies to show the new items
      const collapseKey = getCollapseKey(side, path);
      setCollapsedPaths(prev => {
        const newSet = new Set(prev);
        newSet.delete(collapseKey);  // Expand this thread
        return newSet;
      });

      // Insert into the array that owns this argument structure based on rootSide
      // Nested arguments are stored in the array they belong to (determined by rootSide)
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
      setLoadingButtonPath(null);
    }
  };

  const handleDive = async (side: 'pro' | 'con', path: number[], claim: string, rootSide?: 'pro' | 'con') => {
    if (!topicState) {
      setError('No active topic. Submit a topic first.');
      return;
    }
    setLoadingButtonPath(getPathKey(side, path, 'dive'));
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topicState, targetClaim: claim, targetSide: side, history: { pro: proArgs, con: conArgs }, mode: 'dive' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Request failed');
        return;
      }
      const detail = data.detail as Detail | undefined;
      if (!detail) return;
      // attach detail to the targeted item in the array it belongs to (determined by rootSide)
      const targetRoot = rootSide || side;
      if (targetRoot === 'pro') {
        setProArgs(prev => updateNestedSetDetail(prev, path, detail));
      } else {
        setConArgs(prev => updateNestedSetDetail(prev, path, detail));
      }
    } catch (err) {
      console.error('Dive request failed:', err);
      setError(String(err));
    } finally {
      setLoadingButtonPath(null);
    }
  };

  type ArgumentCardProps = { item: ArgumentItem; side: 'pro' | 'con'; path?: number[]; rootSide?: 'pro' | 'con'; isThreadView?: boolean; applyIndentation?: boolean };
  
  const MAX_DEPTH_LIMIT = 10; // Only show replies up to 10 levels deep in main view
  
  const ArgumentCard = React.memo(function ArgumentCard({ item, side, path = [], rootSide, isThreadView = false, applyIndentation = true }: ArgumentCardProps) {
    const gradientColors = side === 'pro' 
      ? ["#7C3AED", "#2563EB", "#60A5FA"] as const
      : ["#0891B2", "#06B6D4", "#22D3EE"] as const;
    return (
      <View style={{ marginTop: 8 }}>
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.card, styles.gradientCard]}
        >
          <Text style={[styles.claim, styles.gradientText]}>{item.claim || 'Claim'}</Text>
          <Text style={[styles.summary, styles.gradientText]}>{item.summary || ''}</Text>
          {(item.sources || [])
            .filter((s) => typeof s.url === "string" && s.url.startsWith("http"))
            .map((s: Source, j: number) => (
              <TouchableOpacity key={`src-${j}`} onPress={() => Linking.openURL(s.url!)}>
                <Text style={styles.sourceLink}>{s.title || s.url}</Text>
              </TouchableOpacity>
          ))}

          <View style={styles.buttonsContainer}>
            <LinearGradient
              colors={side === 'pro' 
                ? ["#6D28D9", "#1E40AF", "#1E3A8A"] 
                : ["#0D9488", "#0891B2", "#0E7490"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.challengeButton}
            >
              <TouchableOpacity
                style={[styles.challengeButtonInner, loadingButtonPath === getPathKey(side, path, 'counter') && { opacity: 0.5 }]}
                onPress={() => {
                  const claim = item.claim || '';
                  handleCounter(side, path, claim, rootSide || side);
                }}
                disabled={loadingButtonPath === getPathKey(side, path, 'counter')}
                accessibilityRole="button"
              >
                <Text style={styles.challengeButtonText}>Challenge this point</Text>
              </TouchableOpacity>
            </LinearGradient>
            {!item.detail && (
              <LinearGradient
                colors={side === 'pro' 
                  ? ["#7C3AED", "#2563EB", "#60A5FA"] 
                  : ["#0891B2", "#06B6D4", "#22D3EE"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.defendButton}
              >
                <TouchableOpacity
                  style={[styles.defendButtonInner, loadingButtonPath === getPathKey(side, path, 'dive') && { opacity: 0.5 }]}
                  onPress={() => {
                    const claim = item.claim || '';
                    handleDive(side, path, claim, rootSide || side);
                  }}
                  disabled={loadingButtonPath === getPathKey(side, path, 'dive')}
                  accessibilityRole="button"
                >
                  <Text style={styles.defendButtonText}>Defend this point</Text>
                </TouchableOpacity>
              </LinearGradient>
            )}
            {path.length > 0 && !isThreadView && (
              <TouchableOpacity
                onPress={() => openThreadView(side, path, rootSide)}
                style={{
                  marginTop: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  borderRadius: 6,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>
                  → Thread View
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </LinearGradient>

        {item.detail && (
          <LinearGradient
            colors={side === 'pro' 
              ? ["#6D28D9", "#1E40AF"]
              : ["#0D9488", "#0E7490"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.detailWrapGradient}
          >
            <Text style={[styles.detailText, styles.detailTextNeutral]}>
              {item.detail.long_summary}
            </Text>
            {(item.detail.sources || [])
              .filter((s) => typeof s.url === "string" && s.url.startsWith("http"))
              .map((s: Source, si: number) => (
                <TouchableOpacity key={`detail-src-${si}`} onPress={() => Linking.openURL(s.url!)}>
                  <Text style={styles.detailSource}>{s.title || s.url}</Text>
                </TouchableOpacity>
            ))}

          </LinearGradient>
        )}
        
        {(item.replies && item.replies.length > 0) && (() => {
          // If AT depth limit in main view (not in thread view), show button to continue in thread view
          if (path.length >= MAX_DEPTH_LIMIT && !isThreadView) {
            return (
              <TouchableOpacity
                onPress={() => openThreadView(side, path, rootSide)}
                style={{
                  marginTop: 12,
                  marginLeft: applyIndentation ? 16 : 0,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  backgroundColor: 'rgba(124,58,237,0.2)',
                  borderRadius: 6,
                  borderLeftWidth: 3,
                  borderLeftColor: side === 'pro' ? '#7C3AED' : '#0891B2',
                  alignSelf: 'flex-start',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>
                  📖 View full thread to continue
                </Text>
              </TouchableOpacity>
            );
          }
          
          // Show collapsible replies when not at depth limit
          const collapseKey = getCollapseKey(side, path);
          const isCollapsed = collapsedPaths.has(collapseKey);
          const replyCount = item.replies.length;
          
          return (
            <View>
              <TouchableOpacity
                onPress={() => toggleCollapse(side, path)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginTop: 12,
                  marginLeft: applyIndentation ? 16 : 0,
                  paddingVertical: 8,
                  paddingHorizontal: 10,
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  borderRadius: 6,
                  borderLeftWidth: 3,
                  borderLeftColor: side === 'pro' ? '#7C3AED' : '#0891B2',
                  alignSelf: 'flex-start',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600', marginRight: 6 }}>
                  {isCollapsed ? '▶' : '▼'}
                </Text>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>
                  {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
                </Text>
              </TouchableOpacity>
              
              {!isCollapsed && (
                <View style={{ marginTop: 8, borderLeftWidth: applyIndentation ? 2 : 0, borderLeftColor: 'rgba(255, 255, 255, 0.1)', marginLeft: applyIndentation ? 8 : 0 }}>
                  {item.replies.map((r: ArgumentItem, ri: number) => {
                    const replyKey = `reply-${side}-${path.join('-')}-${ri}`;
                    const nextSide = side === 'pro' ? 'con' : 'pro';
                    const isDifferentSide = nextSide !== side;
                    
                    return (
                      <View key={replyKey} style={{ marginLeft: applyIndentation ? 16 : 0, marginTop: 8, position: 'relative' }}>
                        {applyIndentation && (
                          /* Timeline dot indicator */
                          <View
                            style={{
                              position: 'absolute',
                              left: -26,
                              top: 24,
                              width: 10,
                              height: 10,
                              borderRadius: 5,
                              backgroundColor: nextSide === 'pro' ? '#7C3AED' : '#0891B2',
                              borderWidth: 2,
                              borderColor: '#111827',
                            }}
                          />
                        )}
                        <ArgumentCard item={r} side={nextSide} path={path.concat(ri)} rootSide={rootSide} isThreadView={isThreadView} applyIndentation={applyIndentation} />
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })()}
      </View>
    );
  });

  const styles = useMemo(() => StyleSheet.create({
    gradientContainer: {
      flex: 1,
    },
    container: {
      flex: 1,
      justifyContent: "flex-start",
      alignItems: "center",
    },
    mainScroll: {
      flex: 1,
      width: '100%',
    },
    scrollContent: {
      alignItems: 'center',
      paddingVertical: isWeb ? 12 : (isLandscape ? 4 : (isSmallScreen ? 8 : 12)),
    },
    centeredLanding: {
      flex: 1,
      justifyContent: 'center',
      minHeight: 0,
    },
    trendingSection: {
      width: '90%',
      maxWidth: 600,
      marginBottom: isLandscape ? 8 : 12,
    },
    trendingTitle: {
      fontSize: isWeb || !isSmallScreen ? 18 : 14,
      fontWeight: 'bold',
      color: '#fff',
      marginBottom: isWeb ? 10 : (isLandscape ? 6 : 10),
      textAlign: 'center',
    },
    trendingGrid: {
      gap: isWeb || !isSmallScreen ? 10 : 6,
    },
    trendingCard: {
      borderRadius: 12,
      overflow: 'hidden',
    },
    trendingCardGradient: {
      paddingVertical: isWeb || !isSmallScreen ? 16 : 12,
      paddingHorizontal: isWeb || !isSmallScreen ? 12 : 8,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#27354a',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.1)',
    },
    trendingCardText: {
      fontSize: isWeb || !isSmallScreen ? 14 : 12,
      fontWeight: '600',
      color: '#fff',
      textAlign: 'center',
    },
    input: {
      flex: 1,
      minWidth: 100,
      padding: isWeb || !isSmallScreen ? 12 : 8,
      borderWidth: 1,
      borderRadius: 8,
      fontSize: isWeb || !isSmallScreen ? 16 : 14,
      color: '#fff',
    },
    quoteWrap: {
      width: "80%",
      maxWidth: 600,
      marginBottom: isWeb ? 8 : (isLandscape ? 2 : (isSmallScreen ? 4 : 8)),
      paddingHorizontal: 8,
    },
    titleWrap: {
      width: "80%",
      maxWidth: 600,
      marginBottom: isWeb ? 12 : (isLandscape ? 2 : (isSmallScreen ? 6 : 12)),
      paddingHorizontal: 8,
    },
    title: {
      textAlign: "center",
      fontSize: isWeb ? 28 : (isLandscape ? 14 : (isSmallScreen ? 18 : 28)),
      fontWeight: "bold",
      color: "#fff",
      marginBottom: isWeb ? 6 : (isLandscape ? 2 : 6),
    },
    quote: {
      textAlign: "center",
      fontSize: isWeb ? 15 : (isLandscape ? 10 : (isSmallScreen ? 12 : 15)),
      fontWeight: "bold",
      color: "#fff",
    },
    resultsContainer: {
      flexDirection: "row",
      width: "100%",
      paddingHorizontal: isWeb || !isSmallScreen ? 16 : 8,
      marginTop: 8,
      justifyContent: "space-between",
    },
    column: {
      width: isWide ? "48%" : "100%",
    },
    columnTitle: {
      fontSize: isWeb ? 16 : (isSmallScreen ? 11 : (isLandscape ? 12 : 16)),
      fontWeight: "600",
      marginBottom: isWeb ? 6 : (isLandscape ? 3 : (isSmallScreen ? 4 : 6)),
      color: '#fff',
    },
    columnScroll: {
      maxHeight: isLandscape ? Math.max(height - 130, 150) : Math.max(height - 320, 150),
    },
    claim: {
      fontWeight: '700',
      marginBottom: isWeb || !isSmallScreen ? 6 : 4,
      fontSize: isWeb || !isSmallScreen ? 16 : 14,
    },
    summary: {
      marginBottom: isWeb || !isSmallScreen ? 6 : 4,
      fontSize: isWeb || !isSmallScreen ? 14 : 13,
    },
    sourceLink: {
      color: '#fff',
      textDecorationLine: 'underline',
      marginBottom: 4,
      fontSize: isWeb || !isSmallScreen ? 13 : 11,
    },
    inputContainer: {
      width: '100%',
      maxWidth: 600,
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 6,
      gap: isWeb || !isSmallScreen ? 8 : 4,
      flexWrap: 'wrap',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      borderRadius: 12,
      paddingHorizontal: isWeb || !isSmallScreen ? 16 : 8,
      paddingVertical: 0,
      shadowColor: 'transparent',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
      elevation: 0,
    },
    inputField: {
      minWidth: isWeb || !isSmallScreen ? 250 : 150,
      flexGrow: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#1f2937',
      borderRadius: 12,
      paddingHorizontal: isWeb || !isSmallScreen ? 12 : 8,
      paddingVertical: isWeb || !isSmallScreen ? 8 : 6,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
      elevation: 3,
      borderWidth: 1,
      borderColor: 'rgba(124,58,237,0.3)',
    },
    submitButton: {
      marginLeft: isWeb || !isSmallScreen ? 8 : 4,
      paddingHorizontal: isWeb || !isSmallScreen ? 14 : 8,
      paddingVertical: isWeb || !isSmallScreen ? 8 : 6,
      borderRadius: 10,
      flexShrink: 0,
    },
    submitButtonInner: {
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: isWeb || !isSmallScreen ? 14 : 8,
      paddingVertical: isWeb || !isSmallScreen ? 8 : 6,
    },
    submitButtonText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: isWeb || !isSmallScreen ? 14 : 12,
    },
    card: {
      marginBottom: isWeb ? 14 : (isSmallScreen ? 10 : (isLandscape ? 8 : 14)),
      padding: isWeb ? 16 : (isSmallScreen ? 12 : (isLandscape ? 10 : 16)),
      borderRadius: 12,
      minHeight: isWeb ? 72 : (isLandscape ? 60 : 72),
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.2)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.1,
      shadowRadius: 12,
      elevation: 4,
    },
    gradientCard: {
      backgroundColor: 'transparent',
    },
    gradientText: {
      color: '#fff',
    },
    counterButton: {
      marginTop: 8,
      alignSelf: 'flex-start',
      backgroundColor: '#065f46',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
    },
    counterButtonText: {
      color: '#fff',
      fontWeight: '700',
    },
    challengeButton: {
      width: '95%',
      marginTop: isWeb || !isSmallScreen ? 8 : 6,
      borderRadius: 8,
      overflow: 'hidden',
    },
    challengeButtonInner: {
      paddingHorizontal: isWeb || !isSmallScreen ? 10 : 8,
      paddingVertical: isWeb || !isSmallScreen ? 6 : 4,
      justifyContent: 'center',
      alignItems: 'center',
    },
    challengeButtonText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: isWeb || !isSmallScreen ? 14 : 12,
    },
    buttonsContainer: {
      marginTop: isWeb || !isSmallScreen ? 8 : 6,
      flexDirection: 'column',
      alignItems: 'center',
      gap: isWeb || !isSmallScreen ? 8 : 6,
    },
    defendButton: {
      width: '95%',
      marginTop: isWeb || !isSmallScreen ? 0 : 6,
      borderRadius: 8,
      overflow: 'hidden',
    },
    defendButtonInner: {
      paddingHorizontal: isWeb || !isSmallScreen ? 10 : 8,
      paddingVertical: isWeb || !isSmallScreen ? 6 : 4,
      justifyContent: 'center',
      alignItems: 'center',
    },
    defendButtonText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: isWeb || !isSmallScreen ? 14 : 12,
    },
    replyWrap: {
      marginLeft: isWeb || !isSmallScreen ? 14 : 10,
      borderLeftWidth: 2,
      paddingLeft: isWeb || !isSmallScreen ? 10 : 8,
      marginTop: isWeb || !isSmallScreen ? 8 : 6,
    },
    replyWrapPro: {
      borderLeftColor: 'rgba(233, 213, 255, 0.6)',
    },
    replyWrapCon: {
      borderLeftColor: 'rgba(255, 218, 185, 0.6)',
    },
    replyWrapNeutral: {
      borderLeftColor: 'rgba(255,255,255,0.3)',
    },
    proCard: {
      backgroundColor: '#7C3AED',
      borderColor: '#6D28D9',
    },
    proClaim: {
      color: '#fff',
      fontSize: 16,
    },
    proSummary: {
      color: '#F3E8FF',
      fontSize: 14,
      lineHeight: 20,
    },
    proSource: {
      color: '#E9D5FF',
      textDecorationLine: 'underline',
      fontSize: 13,
    },
    conCard: {
      backgroundColor: '#F97316',
      borderColor: '#EA580C',
    },
    conClaim: {
      color: '#071327',
    },
    conSummary: {
      color: '#071327',
      fontSize: 16,
    },
    conSource: {
      color: '#0F172A',
      fontSize: 14,
      lineHeight: 20,
      textDecorationLine: 'underline',
    },
    clearButton: {
      paddingHorizontal: isWeb || !isSmallScreen ? 12 : 8,
      paddingVertical: isWeb || !isSmallScreen ? 8 : 6,
      borderRadius: 10,
      flexShrink: 0,
    },
    clearButtonInner: {
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: isWeb || !isSmallScreen ? 12 : 8,
      paddingVertical: isWeb || !isSmallScreen ? 8 : 6,
    },
    clearButtonText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: isWeb || !isSmallScreen ? 14 : 12,
    },
    debugText: {
      fontSize: 12,
      color: '#6B7280',
      marginTop: 2,
    },
    detailWrap: {
      marginTop: 8,
      padding: 12,
      borderRadius: 10,
      backgroundColor: 'rgba(124,58,237,0.15)',
    },
    detailWrapGradient: {
      marginTop: isWeb || !isSmallScreen ? 8 : 6,
      padding: isWeb || !isSmallScreen ? 12 : 10,
      borderRadius: 10,
      overflow: 'hidden',
    },
    detailText: {
      marginBottom: isWeb || !isSmallScreen ? 8 : 6,
      fontSize: isWeb || !isSmallScreen ? 14 : 13,
    },
    detailSource: {
      color: '#fff',
      textDecorationLine: 'underline',
      marginBottom: 6,
      fontSize: isWeb || !isSmallScreen ? 13 : 11,
    },
    detailWrapPro: {
      backgroundColor: 'rgba(124,58,237,0.12)',
    },
    detailTextPro: {
      color: '#000000',
    },
    detailWrapCon: {
      backgroundColor: 'rgba(249,115,22,0.12)',
    },
    detailTextCon: {
      color: '#071327',
    },
    detailWrapNeutral: {
      backgroundColor: 'rgba(124,58,237,0.15)',
    },
    detailWrapProLight: {
      backgroundColor: 'rgba(124,58,237,0.08)',
    },
    detailWrapConLight: {
      backgroundColor: 'rgba(8,145,178,0.08)',
    },
    detailTextNeutral: {
      color: '#fff',
    },
    detailSourcePro: {
      color: '#1D4ED8',
    },
    detailSourceCon: {
      color: '#1E40AF',
    },
    threadViewContainer: {
      flex: 1,
      width: '100%',
      backgroundColor: '#111827',
      borderTopWidth: 1,
      borderTopColor: 'rgba(255,255,255,0.1)',
    },
    threadViewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#1f2937',
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(255,255,255,0.1)',
      paddingVertical: 8,
      paddingHorizontal: isWeb || !isSmallScreen ? 16 : 12,
    },
    threadViewBackButton: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 6,
      backgroundColor: 'rgba(124,58,237,0.3)',
    },
    threadViewBackText: {
      color: '#fff',
      fontWeight: '600',
      fontSize: isWeb || !isSmallScreen ? 13 : 11,
    },
    threadViewScroll: {
      flex: 1,
      width: '100%',
    },
    threadViewContent: {
      width: '100%',
      alignItems: 'center',
      paddingHorizontal: isWeb || !isSmallScreen ? 16 : 12,
      paddingVertical: isWeb || !isSmallScreen ? 12 : 8,
    },
    errorText: {
      color: '#ff6b6b',
      fontSize: 14,
      marginTop: 12,
      textAlign: 'center',
    },
  }), [isWide, isSmallScreen, isLandscape, isWeb, height]);

  return (
    <LinearGradient
      colors={['#111827', '#1f2937']}
      start={{ x: 0, y: 0 }}
      end={{ x: .1, y: 1 }}
      style={styles.gradientContainer}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {(proArgs.length > 0 || conArgs.length > 0) && !isWeb && (
          <LinearGradient
            colors={['#7C3AED', '#2563EB', '#0891B2', '#06B6D4', '#22D3EE']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              zIndex: 1000,
              borderRadius: 8,
            }}
          >
            <TouchableOpacity
              onPress={() => setHideInputOnMobile(!hideInputOnMobile)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 8,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 12 }}>
                {hideInputOnMobile ? 'Show' : 'Hide'}
              </Text>
            </TouchableOpacity>
          </LinearGradient>
        )}
        <ScrollView 
          style={styles.mainScroll}
          contentContainerStyle={
            proArgs.length === 0 && conArgs.length === 0
              ? [styles.scrollContent, styles.centeredLanding]
              : styles.scrollContent
          }
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.titleWrap}>
            <Text style={styles.title}>The Objectivity</Text>
          </View>
          <View style={styles.quoteWrap}>
            <Text style={styles.quote}>
              Hear both sides. Decide for yourself.
            </Text>
              {/* "There is no such thing as objectivity. The best you can do is hear both sides argued well, and decide for yourself." */}
          </View>
          <View style={styles.inputContainer}>
          {!hideInputOnMobile && (
            <>
          <View style={styles.inputField}>
          <TextInput
            value={value}
            onChangeText={setValue}
            onSubmitEditing={handleSubmit}
            placeholder="Enter a topic to explore both sides"
            style={styles.input}
            returnKeyType="done"
            autoFocus
            placeholderTextColor="#9CA3AF"
            editable={!loading}
          />
          <LinearGradient
            colors={['#7C3AED', '#2563EB', '#0891B2', '#06B6D4', '#22D3EE']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.submitButton}
          >
            <TouchableOpacity style={[styles.submitButtonInner, loading && { opacity: 0.5 }]} onPress={!loading ? handleSubmit : undefined} disabled={loading} accessibilityRole="button">
              <Text style={styles.submitButtonText}>Start Debate</Text>
            </TouchableOpacity>
          </LinearGradient>
        </View>
        {(value.trim() !== '' || proArgs.length > 0 || conArgs.length > 0) && (
          <LinearGradient
            colors={['#6b7280', '#4b5563']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.clearButton}
          >
            <TouchableOpacity style={[styles.clearButtonInner, loading && { opacity: 0.5 }]} onPress={!loading ? clearDebate : undefined} disabled={loading} accessibilityRole="button">
              <Text style={styles.clearButtonText}>Clear Debate</Text>
            </TouchableOpacity>
          </LinearGradient>
        )}
            </>
          )}
        {loading && (
          <View style={{ paddingLeft: 12, justifyContent: 'center' }}>
            <ActivityIndicator size="small" />
          </View>
        )}
      </View>
      {proArgs.length === 0 && conArgs.length === 0 && (
        <View style={styles.trendingSection}>
          <Text style={styles.trendingTitle}>Trending Debates</Text>
          <View style={styles.trendingGrid}>
            {['Will AI replace lawyers?', 'My employer should let me work remotely', 'Should billionaires exist?'].map((topic, index) => (
              <TouchableOpacity
                key={index}
                style={[styles.trendingCard, loading && { opacity: 0.5 }]}
                disabled={loading}
                onPress={!loading ? async () => {
                  setValue(topic);
                  setLoading(true);
                  setError(null);
                  try {
                    const res = await fetch(`${apiBase}/api/chat`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ topic }),
                    });
                    const data = await res.json();
                    if (!res.ok) {
                      setError(data?.error || 'Request failed');
                      setProArgs([]);
                      setConArgs([]);
                    } else {
                      setProArgs(data.pro || []);
                      setConArgs(data.con || []);
                      setTopicState(topic);
                    }
                  } catch (err) {
                    setError(String(err));
                  } finally {
                    setLoading(false);
                  }
                } : undefined}
              >
                <LinearGradient
                  colors={["#27354a", "#1f2937"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.trendingCardGradient}
                >
                  <Text style={styles.trendingCardText}>{topic}</Text>
                </LinearGradient>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
      {false && (
        <View style={{ width: '80%', maxWidth: 600, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        </View>
      )}
      {error ? <Text style={{ color: 'red', marginTop: 8 }}>{error}</Text> : null}

      {(proArgs.length > 0 || conArgs.length > 0) && threadViewPath === null && (
        <View style={[styles.resultsContainer, { flexDirection: isWide ? 'row' : 'column' }]}>
          <View style={[styles.column, { width: isWide ? '48%' : '100%' }]}>
            <Text style={styles.columnTitle}>Pro</Text>
            <ScrollView
              style={[styles.columnScroll, isWeb ? { maxHeight: height - 220 } : undefined]}
              contentContainerStyle={isWeb ? { paddingBottom: 88 } : undefined}
            >
                  {proArgs.map((a: ArgumentItem, i: number) => (
                    <ArgumentCard key={`pro-${i}`} item={a} side="pro" path={[i]} rootSide="pro" />
                  ))}

                  
            </ScrollView>
          </View>

          <View style={[styles.column, { width: isWide ? '48%' : '100%', marginTop: isWide ? 0 : 12 }]}>
            <Text style={styles.columnTitle}>Con</Text>
            <ScrollView
              style={[styles.columnScroll, isWeb ? { maxHeight: height - 220 } : undefined]}
              contentContainerStyle={isWeb ? { paddingBottom: 88 } : undefined}
            >
                {conArgs.map((a: ArgumentItem, i: number) => (
                  <ArgumentCard key={`con-${i}`} item={a} side="con" path={[i]} rootSide="con" />
                ))}

                
            </ScrollView>
          </View>
        </View>
      )}

      {threadViewPath && (
        <View style={styles.threadViewContainer}>
          <View style={styles.threadViewHeader}>
            <TouchableOpacity onPress={closeThreadView} style={styles.threadViewBackButton}>
              <Text style={styles.threadViewBackText}>← Back</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={[styles.threadViewScroll, isWeb ? { maxHeight: height - 280 } : undefined]}
            contentContainerStyle={isWeb ? { paddingBottom: 88 } : undefined}
          >
            {(() => {
              const threadArg = getArgumentAtPath(threadViewPath.rootSide, threadViewPath.path);
              return threadArg ? (
                <View style={styles.threadViewContent}>
                  <ArgumentCard 
                    item={threadArg} 
                    side={threadViewPath.side} 
                    path={threadViewPath.path}
                    rootSide={threadViewPath.rootSide}
                    isThreadView={true}
                    applyIndentation={false}
                  />
                </View>
              ) : (
                <Text style={styles.errorText}>Thread not found</Text>
              );
            })()}
          </ScrollView>
        </View>
      )}
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}
