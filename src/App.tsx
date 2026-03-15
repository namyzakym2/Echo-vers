import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Activity, 
  MessageSquare, 
  Terminal, 
  Settings, 
  Shield, 
  RefreshCw,
  ExternalLink,
  Bot,
  CheckCircle2,
  AlertCircle,
  Clock,
  Trophy,
  User,
  Zap,
  X,
  Award,
  Star
} from 'lucide-react';
import { db } from './firebase';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';

interface BotStatus {
  status: string;
  user: string | null;
  lastMessage: string;
  logs: string[];
}

interface UserData {
  id: string;
  username: string;
  avatar: string;
  xp: number;
  level: number;
}

export default function App() {
  const [data, setData] = useState<BotStatus | null>(null);
  const [users, setUsers] = useState<UserData[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const fetchUser = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const user = await res.json();
        setCurrentUser(user);
      }
    } catch (err) {
      console.error("Failed to fetch user", err);
    }
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Failed to fetch status');
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError('Could not connect to the bot server. Make sure the server is running.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        fetchUser();
      }
    };
    window.addEventListener('message', handleMessage);

    // Real-time Leaderboard
    const q = query(collection(db, "users"), orderBy("level", "desc"), orderBy("xp", "desc"), limit(10));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const usersData: UserData[] = [];
      snapshot.forEach((doc) => {
        usersData.push({ id: doc.id, ...doc.data() } as UserData);
      });
      setUsers(usersData);
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const handleLogin = () => {
    window.open('/api/auth/discord', 'discord_oauth', 'width=600,height=700');
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-zinc-100 font-sans selection:bg-indigo-500/30">
      {/* Navigation */}
      <nav className="border-b border-zinc-800/50 bg-black/20 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold tracking-tight text-lg">Discord Bot Manager</span>
          </div>
          <div className="flex items-center gap-4">
            {currentUser ? (
              <div className="flex items-center gap-3 bg-zinc-800/50 px-3 py-1.5 rounded-full border border-zinc-700/50">
                <img 
                  src={`https://cdn.discordapp.com/avatars/${currentUser.id}/${currentUser.avatar}.png`} 
                  alt={currentUser.username} 
                  className="w-6 h-6 rounded-full"
                  referrerPolicy="no-referrer"
                />
                <span className="text-sm font-medium">{currentUser.username}</span>
                <a href="/api/auth/logout" className="text-xs text-zinc-500 hover:text-rose-400 transition-colors">Logout</a>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 bg-[#5865F2] hover:bg-[#4752C4] text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
              >
                <Bot className="w-4 h-4" />
                Login with Discord
              </button>
            )}
            <button 
              onClick={fetchStatus}
              className="p-2 hover:bg-zinc-800 rounded-full transition-colors text-zinc-400 hover:text-zinc-100"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <a 
              href="https://discord.com/developers/applications" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm font-medium text-zinc-400 hover:text-indigo-400 transition-colors"
            >
              Developer Portal <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-10">
        {/* Header Section */}
        <div className="mb-12">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl font-bold tracking-tight mb-3"
          >
            Bot Overview
          </motion.h1>
          <p className="text-zinc-400 max-w-2xl">
            Monitor your bot's real-time status, view incoming messages, and check system logs. 
            Configure your token in the environment variables to get started.
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <StatusCard 
            title="Status" 
            value={data?.status || 'Unknown'} 
            icon={<Activity className="w-5 h-5" />}
            color={data?.status === 'Online' ? 'text-emerald-400' : 'text-rose-400'}
            statusIcon={data?.status === 'Online' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          />
          <StatusCard 
            title="Bot Identity" 
            value={data?.user || 'Not Logged In'} 
            icon={<Shield className="w-5 h-5" />}
            color="text-indigo-400"
          />
          <StatusCard 
            title="Last Activity" 
            value={data?.lastMessage || 'None'} 
            icon={<MessageSquare className="w-5 h-5" />}
            color="text-amber-400"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Leaderboard Section */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/80">
                <div className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-amber-400" />
                  <span className="font-semibold">Top Users</span>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <AnimatePresence>
                  {users.map((user, index) => (
                    <motion.div
                      key={user.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={() => setSelectedUser(user)}
                      className="flex items-center justify-between p-3 bg-zinc-800/30 rounded-xl border border-zinc-800/50 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all group cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          {user.avatar ? (
                            <img src={user.avatar} alt={user.username} className="w-10 h-10 rounded-full border border-zinc-700" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center border border-zinc-700">
                              <User className="w-5 h-5 text-zinc-500" />
                            </div>
                          )}
                          <div className="absolute -top-1 -left-1 w-5 h-5 bg-zinc-900 rounded-full border border-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-400">
                            {index + 1}
                          </div>
                        </div>
                        <div>
                          <div className="font-medium text-sm group-hover:text-indigo-400 transition-colors">{user.username || 'Unknown'}</div>
                          <div className="text-[10px] text-zinc-500 flex items-center gap-1">
                            <Zap className="w-3 h-3 text-amber-500" /> {user.xp} XP
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-bold text-indigo-400">LVL {user.level}</div>
                        <div className="w-16 h-1 bg-zinc-800 rounded-full mt-1 overflow-hidden">
                          <div 
                            className="h-full bg-indigo-500 transition-all duration-500" 
                            style={{ width: `${(user.xp / (user.level * 100)) * 100}%` }}
                          />
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  {users.length === 0 && (
                    <div className="text-center py-10 text-zinc-600 italic text-sm">
                      No users found yet.
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Logs Section */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col h-[500px]">
              <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/80">
                <div className="flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-zinc-400" />
                  <span className="font-semibold">System Logs</span>
                </div>
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-rose-500/20 border border-rose-500/50" />
                  <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/50" />
                  <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/50" />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-6 font-mono text-sm space-y-2 scrollbar-thin scrollbar-thumb-zinc-800">
                <AnimatePresence initial={false}>
                  {data?.logs.map((log, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="text-zinc-400 border-l-2 border-zinc-800 pl-3 py-1 hover:bg-white/5 transition-colors rounded-r"
                    >
                      {log}
                    </motion.div>
                  ))}
                  {(!data?.logs || data.logs.length === 0) && (
                    <div className="text-zinc-600 italic">Waiting for logs...</div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Sidebar / Configuration */}
          <div className="space-y-6">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-6">
                <Settings className="w-5 h-5 text-zinc-400" />
                <span className="font-semibold">Configuration</span>
              </div>
              
              <div className="space-y-4">
                <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700/50">
                  <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Setup Guide</h4>
                  <ol className="text-sm text-zinc-400 space-y-3 list-decimal list-inside">
                    <li>Go to Discord Dev Portal</li>
                    <li>Create a New Application</li>
                    <li>Go to Bot tab and copy Token</li>
                    <li>Add token to <code className="text-indigo-400 bg-indigo-500/10 px-1 rounded">DISCORD_TOKEN</code> in secrets</li>
                  </ol>
                </div>

                <div className="p-4 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-semibold text-indigo-300 mb-1">Intents Required</h4>
                      <p className="text-xs text-indigo-300/70 leading-relaxed">
                        Ensure "Message Content Intent" is enabled in your bot settings to read commands.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-5 h-5 text-zinc-400" />
                <span className="font-semibold">Quick Commands</span>
              </div>
              <div className="space-y-2">
                <CommandItem cmd="/ping" desc="Check bot latency" />
                <CommandItem cmd="/level" desc="Check your XP & level" />
                <CommandItem cmd="/request [feature]" desc="Request a new feature" />
                <CommandItem cmd="/add-cmd [name] [reply]" desc="Add a custom text command" />
                <CommandItem cmd="/edit-command [old] [new]" desc="Rename an existing command" />
                <CommandItem cmd="/setup-tickets @Role" desc="Create ticket panel" />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 right-8 bg-rose-500 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 z-[100]"
          >
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium">{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* User Profile Modal */}
      <AnimatePresence>
        {selectedUser && (
          <UserProfileModal 
            user={selectedUser} 
            onClose={() => setSelectedUser(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function UserProfileModal({ user, onClose }: { user: UserData, onClose: () => void }) {
  const xpProgress = (user.xp / (user.level * 100)) * 100;
  
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl"
      >
        {/* Header/Banner */}
        <div className="h-32 bg-gradient-to-br from-indigo-600 to-violet-700 relative">
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-black/20 hover:bg-black/40 rounded-full text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Profile Info */}
        <div className="px-8 pb-8 -mt-12 relative">
          <div className="flex flex-col items-center">
            <div className="w-24 h-24 rounded-full border-4 border-zinc-900 bg-zinc-800 overflow-hidden shadow-xl mb-4">
              {user.avatar ? (
                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <User className="w-10 h-10 text-zinc-600" />
                </div>
              )}
            </div>
            
            <h2 className="text-2xl font-bold tracking-tight mb-1">{user.username}</h2>
            <p className="text-zinc-500 text-sm font-mono mb-6">ID: {user.id}</p>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-4 w-full mb-8">
              <div className="bg-zinc-800/50 border border-zinc-800 p-4 rounded-2xl flex flex-col items-center">
                <Trophy className="w-5 h-5 text-amber-400 mb-2" />
                <span className="text-xs text-zinc-500 uppercase font-bold tracking-wider">Level</span>
                <span className="text-2xl font-black text-white">{user.level}</span>
              </div>
              <div className="bg-zinc-800/50 border border-zinc-800 p-4 rounded-2xl flex flex-col items-center">
                <Zap className="w-5 h-5 text-indigo-400 mb-2" />
                <span className="text-xs text-zinc-500 uppercase font-bold tracking-wider">Total XP</span>
                <span className="text-2xl font-black text-white">{user.xp}</span>
              </div>
            </div>

            {/* Progress Section */}
            <div className="w-full space-y-3">
              <div className="flex justify-between items-end">
                <span className="text-sm font-semibold text-zinc-400">Level Progress</span>
                <span className="text-xs font-mono text-zinc-500">{user.xp} / {user.level * 100} XP</span>
              </div>
              <div className="h-3 bg-zinc-800 rounded-full overflow-hidden border border-zinc-700/50">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${xpProgress}%` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                  className="h-full bg-gradient-to-r from-indigo-500 to-violet-500"
                />
              </div>
              <p className="text-[10px] text-center text-zinc-600 italic">
                {user.level * 100 - user.xp} XP remaining until Level {user.level + 1}
              </p>
            </div>

            {/* Badges/Achievements Placeholder */}
            <div className="mt-8 pt-8 border-t border-zinc-800 w-full">
              <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Award className="w-4 h-4" /> Achievements
              </h4>
              <div className="flex gap-3">
                <Badge icon={<Star className="w-3 h-3" />} label="Early Member" />
                {user.level >= 5 && <Badge icon={<Zap className="w-3 h-3" />} label="Active Talker" />}
                {user.level >= 10 && <Badge icon={<Trophy className="w-3 h-3" />} label="Veteran" />}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Badge({ icon, label }: { icon: React.ReactNode, label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-800 rounded-lg border border-zinc-700/50 text-zinc-400">
      {icon}
      <span className="text-[10px] font-bold">{label}</span>
    </div>
  );
}

function StatusCard({ title, value, icon, color, statusIcon }: { title: string, value: string, icon: React.ReactNode, color: string, statusIcon?: React.ReactNode }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl hover:border-zinc-700 transition-all group">
      <div className="flex items-center justify-between mb-4">
        <div className="p-2 bg-zinc-800 rounded-lg text-zinc-400 group-hover:text-zinc-100 transition-colors">
          {icon}
        </div>
        {statusIcon && <div className={color}>{statusIcon}</div>}
      </div>
      <h3 className="text-zinc-500 text-sm font-medium mb-1">{title}</h3>
      <p className={`text-xl font-bold truncate ${color}`}>{value}</p>
    </div>
  );
}

function CommandItem({ cmd, desc }: { cmd: string, desc: string }) {
  return (
    <div className="flex items-center justify-between p-3 bg-zinc-800/30 rounded-xl border border-zinc-800 hover:border-zinc-700 transition-colors cursor-default group">
      <code className="text-indigo-400 font-mono text-sm">{cmd}</code>
      <span className="text-xs text-zinc-500 group-hover:text-zinc-400 transition-colors">{desc}</span>
    </div>
  );
}
