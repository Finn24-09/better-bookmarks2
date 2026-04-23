import { User, KeyRound, LogOut, Trash2, Mail, Upload, Download } from "lucide-react";
import { useNavigate } from "react-router";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";
import { useAuth } from "../contexts/AuthContext";

interface HeaderProps {
  onChangePassword: () => void;
  onDeleteAccount: () => void;
  onImportBookmarks: () => void;
  onExportBookmarks: () => void;
}

export function Header({ onChangePassword, onDeleteAccount, onImportBookmarks, onExportBookmarks }: HeaderProps) {
  const navigate = useNavigate();
  const { email, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="sticky top-0 z-50 py-4 md:py-5 bg-white/5 backdrop-blur-xl border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="w-7 h-7" />
          <h1 className="text-white drop-shadow-lg">Better Bookmarks 2</h1>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-12 h-12 bg-white/5 backdrop-blur-xl border border-white/10 rounded-full flex items-center justify-center hover:bg-white/10 hover:border-white/20 hover:scale-110 transition-all duration-300 active:scale-95 focus:outline-none">
              <User className="w-6 h-6 text-white/80" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            sideOffset={8}
            className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl shadow-purple-500/20 p-1.5 min-w-[220px]"
          >
            {/* Email display */}
            <div className="flex items-center gap-3 px-3 py-2.5 text-sm text-white/50 cursor-default select-none">
              <Mail className="w-4 h-4 shrink-0" />
              <span className="truncate">{email ?? "—"}</span>
            </div>

            <DropdownMenuSeparator className="bg-white/10 my-1" />

            <DropdownMenuItem
              onSelect={onChangePassword}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/80 hover:text-white focus:text-white focus:bg-white/10 cursor-pointer transition-all duration-300"
            >
              <KeyRound className="w-4 h-4 shrink-0" />
              Change Password
            </DropdownMenuItem>

            <DropdownMenuSeparator className="bg-white/10 my-1" />

            <DropdownMenuItem
              onSelect={handleLogout}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/80 hover:text-white focus:text-white focus:bg-white/10 cursor-pointer transition-all duration-300"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              Log Out
            </DropdownMenuItem>

            <DropdownMenuSeparator className="bg-white/10 my-1" />

            <DropdownMenuItem
              onSelect={onImportBookmarks}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/80 hover:text-white focus:text-white focus:bg-white/10 cursor-pointer transition-all duration-300"
            >
              <Upload className="w-4 h-4 shrink-0" />
              Import Bookmarks
            </DropdownMenuItem>

            <DropdownMenuItem
              onSelect={onExportBookmarks}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/80 hover:text-white focus:text-white focus:bg-white/10 cursor-pointer transition-all duration-300"
            >
              <Download className="w-4 h-4 shrink-0" />
              Export Bookmarks
            </DropdownMenuItem>

            <DropdownMenuSeparator className="bg-white/10 my-1" />

            <DropdownMenuItem
              onSelect={onDeleteAccount}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-400 hover:text-red-300 focus:text-red-300 focus:bg-red-500/10 cursor-pointer transition-all duration-300"
            >
              <Trash2 className="w-4 h-4 shrink-0" />
              Delete Account
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
