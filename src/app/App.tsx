import { useState } from "react";
import { motion, LayoutGroup } from "motion/react";
import { Header } from "./components/Header";
import { SearchBar } from "./components/SearchBar";
import { TagFilter } from "./components/TagFilter";
import { BookmarkCard } from "./components/BookmarkCard";
import { FloatingFooter } from "./components/FloatingFooter";
import { AddBookmarkButton } from "./components/AddBookmarkButton";
import { BookmarkFormModal } from "./components/BookmarkFormModal";
import { ChangePasswordModal } from "./components/ChangePasswordModal";
import { DeleteAccountModal } from "./components/DeleteAccountModal";

// Dummy data for demonstration
const bookmarks = [
  {
    id: 1,
    thumbnail: "https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=800&auto=format&fit=crop",
    title: "Complete React Tutorial for Beginners - Build a Full Application",
    url: "youtube.com/watch?v=example1",
    tags: ["React", "Tutorial", "JavaScript"],
  },
  {
    id: 2,
    thumbnail: "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=800&auto=format&fit=crop",
    title: "Advanced TypeScript Patterns You Should Know",
    url: "youtube.com/watch?v=example2",
    tags: ["TypeScript", "Advanced"],
  },
  {
    id: 3,
    thumbnail: "https://images.unsplash.com/photo-1587620962725-abab7fe55159?w=800&auto=format&fit=crop",
    title: "CSS Grid and Flexbox - Complete Layout Guide",
    url: "vimeo.com/example3",
    tags: ["CSS", "Design", "Tutorial"],
  },
  {
    id: 4,
    thumbnail: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&auto=format&fit=crop",
    title: "Building REST APIs with Node.js and Express",
    url: "youtube.com/watch?v=example4",
    tags: ["Node.js", "Backend", "API"],
  },
  {
    id: 5,
    thumbnail: "https://images.unsplash.com/photo-1593720213428-28a5b9e94613?w=800&auto=format&fit=crop",
    title: "Python Data Science Masterclass - Complete Course",
    url: "udemy.com/example5",
    tags: ["Python", "Data Science"],
  },
  {
    id: 6,
    thumbnail: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&auto=format&fit=crop",
    title: "Vue.js 3 Composition API Deep Dive",
    url: "youtube.com/watch?v=example6",
    tags: ["Vue", "JavaScript", "Advanced"],
  },
  {
    id: 7,
    thumbnail: "https://images.unsplash.com/photo-1551650975-87deedd944c3?w=800&auto=format&fit=crop",
    title: "Docker and Kubernetes for Beginners",
    url: "youtube.com/watch?v=example7",
    tags: ["Docker", "DevOps", "Tutorial"],
  },
  {
    id: 8,
    thumbnail: "https://images.unsplash.com/photo-1515879218367-8466d910aaa4?w=800&auto=format&fit=crop",
    title: "Mobile App Design Principles and Best Practices",
    url: "vimeo.com/example8",
    tags: ["Design", "UI/UX"],
  },
  {
    id: 9,
    thumbnail: "https://images.unsplash.com/photo-1484417894907-623942c8ee29?w=800&auto=format&fit=crop",
    title: "GraphQL Full Course - Building Modern APIs",
    url: "youtube.com/watch?v=example9",
    tags: ["GraphQL", "API", "Backend"],
  },
];

const allTags = Array.from(
  new Set(bookmarks.flatMap((bookmark) => bookmark.tags))
).sort();

export default function App() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBookmark, setEditingBookmark] = useState<typeof bookmarks[0] | null>(null);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);

  const handleOpenAdd = () => { setEditingBookmark(null); setModalOpen(true); };
  const handleOpenEdit = (bookmark: typeof bookmarks[0]) => { setEditingBookmark(bookmark); setModalOpen(true); };
  const handleClose = () => setModalOpen(false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950">
      {/* Header */}
      <Header
        onChangePassword={() => setChangePasswordOpen(true)}
        onDeleteAccount={() => setDeleteAccountOpen(true)}
      />

      <LayoutGroup>
        <div className="max-w-7xl mx-auto space-y-6 md:space-y-8 px-4 md:px-6 lg:px-8 pt-6 md:pt-8 pb-8">

          {/* Search and Filters */}
          <div className="space-y-4">
            {/* Search Bar */}
            <SearchBar />

            {/* Tag Filters */}
            <TagFilter tags={allTags} />
          </div>

          {/* Bookmarks Grid — layout so it smoothly repositions when TagFilter resizes */}
          <motion.div
            layout
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6"
          >
            {bookmarks.map((bookmark) => (
              <BookmarkCard
                key={bookmark.id}
                thumbnail={bookmark.thumbnail}
                title={bookmark.title}
                url={bookmark.url}
                tags={bookmark.tags}
                onEdit={() => handleOpenEdit(bookmark)}
              />
            ))}
          </motion.div>
        </div>
      </LayoutGroup>

      {/* Add Bookmark Button - fixed FAB aligned to grid */}
      <div className="fixed bottom-20 left-0 right-0 z-40 pointer-events-none" style={{ paddingRight: 'var(--removed-body-scroll-bar-size, 0px)' }}>
        <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
          <div className="flex justify-end">
            <div className="pointer-events-auto">
              <AddBookmarkButton onClick={handleOpenAdd} />
            </div>
          </div>
        </div>
      </div>

      {/* Floating Footer */}
      <FloatingFooter />

      {/* Add / Edit Bookmark Modal */}
      <BookmarkFormModal
        open={modalOpen}
        onClose={handleClose}
        initialData={editingBookmark}
        availableTags={allTags}
      />

      {/* Change Password Modal */}
      <ChangePasswordModal
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />

      {/* Delete Account Modal */}
      <DeleteAccountModal
        open={deleteAccountOpen}
        onClose={() => setDeleteAccountOpen(false)}
      />
    </div>
  );
}