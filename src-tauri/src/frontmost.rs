//! The kind of app in front when a burst of typing starts: writing, code, browser, game or
//! other. Only the kind is ever kept, as one word; the app's name, its bundle identifier and
//! anything in its windows are never stored or sent anywhere.
//!
//! On macOS this reads NSWorkspace's frontmost application and its bundle identifier, which
//! needs no permission (no window titles, no Accessibility, no Screen Recording). An app not in
//! the table below counts as a game when its own Info.plist says it is one
//! (LSApplicationCategoryType public.app-category.*games), otherwise as "other". Anything that
//! cannot be read is "other". On other systems everything is "other".

use crate::rhythm::AppKind;

/// Bundle identifiers, or prefixes ending in '.', and their kind. Matched in order.
const TABLE: &[(&str, AppKind)] = &[
  // Writing: mail, notes, documents, chat.
  ("com.apple.mail", AppKind::Writing),
  ("com.microsoft.Outlook", AppKind::Writing),
  ("com.readdle.smartemail-Mac", AppKind::Writing),
  ("com.superhuman.electron", AppKind::Writing),
  ("com.apple.Notes", AppKind::Writing),
  ("com.apple.TextEdit", AppKind::Writing),
  ("com.apple.iWork.Pages", AppKind::Writing),
  ("com.microsoft.Word", AppKind::Writing),
  ("com.microsoft.onenote.mac", AppKind::Writing),
  ("md.obsidian", AppKind::Writing),
  ("notion.id", AppKind::Writing),
  ("com.ulyssesapp.mac", AppKind::Writing),
  ("pro.writer.mac", AppKind::Writing),
  ("com.literatureandlatte.scrivener3", AppKind::Writing),
  ("com.google.drivefs", AppKind::Writing),
  ("com.tinyspeck.slackmacgap", AppKind::Writing),
  ("com.apple.MobileSMS", AppKind::Writing),
  ("net.whatsapp.WhatsApp", AppKind::Writing),
  ("desktop.WhatsApp", AppKind::Writing),
  ("ru.keepcoder.Telegram", AppKind::Writing),
  ("org.telegram.desktop", AppKind::Writing),
  ("com.hnc.Discord", AppKind::Writing),
  ("com.microsoft.teams2", AppKind::Writing),
  ("com.microsoft.teams", AppKind::Writing),
  ("org.whispersystems.signal-desktop", AppKind::Writing),
  ("com.facebook.archon", AppKind::Writing),
  // Code: editors and terminals.
  ("com.microsoft.VSCode", AppKind::Code),
  ("com.apple.dt.Xcode", AppKind::Code),
  ("com.apple.Terminal", AppKind::Code),
  ("com.googlecode.iterm2", AppKind::Code),
  ("dev.warp.Warp-Stable", AppKind::Code),
  ("com.mitchellh.ghostty", AppKind::Code),
  ("net.kovidgoyal.kitty", AppKind::Code),
  ("io.alacritty", AppKind::Code),
  ("dev.zed.Zed", AppKind::Code),
  ("com.sublimetext.", AppKind::Code),
  ("com.jetbrains.", AppKind::Code),
  ("com.todesktop.230313mzl4w4u92", AppKind::Code), // Cursor
  ("com.exafunction.windsurf", AppKind::Code),
  ("com.panic.Nova", AppKind::Code),
  ("org.vim.MacVim", AppKind::Code),
  ("org.gnu.Emacs", AppKind::Code),
  // Browsers.
  ("com.apple.Safari", AppKind::Browser),
  ("com.google.Chrome", AppKind::Browser),
  ("org.mozilla.firefox", AppKind::Browser),
  ("com.microsoft.edgemac", AppKind::Browser),
  ("company.thebrowser.Browser", AppKind::Browser),
  ("com.brave.Browser", AppKind::Browser),
  ("com.operasoftware.Opera", AppKind::Browser),
  ("com.vivaldi.Vivaldi", AppKind::Browser),
  ("app.zen-browser.zen", AppKind::Browser),
  // Games and game launchers.
  ("com.valvesoftware.", AppKind::Game),
  ("com.blizzard.", AppKind::Game),
  ("com.riotgames.", AppKind::Game),
  ("com.epicgames.", AppKind::Game),
  ("com.mojang.", AppKind::Game),
  ("unity.", AppKind::Game),
  ("com.ea.", AppKind::Game),
  ("com.feralinteractive.", AppKind::Game),
  ("com.aspyr.", AppKind::Game),
];

/// The kind for a bundle identifier from the table, or None when it is not listed.
pub fn kind_from_table(bundle_id: &str) -> Option<AppKind> {
  TABLE.iter().find_map(|(id, kind)| {
    let hit = if id.ends_with('.') { bundle_id.starts_with(id) } else { bundle_id == *id };
    hit.then_some(*kind)
  })
}

/// The kind from an app's own declared category (Info.plist LSApplicationCategoryType).
pub fn kind_from_category(category: &str) -> AppKind {
  if category.starts_with("public.app-category.") && category.contains("games") {
    AppKind::Game
  } else {
    AppKind::Other
  }
}

#[cfg(target_os = "macos")]
pub fn frontmost_kind() -> AppKind {
  use objc2_app_kit::NSWorkspace;
  use objc2_foundation::{NSBundle, NSString};
  let read = || -> Option<AppKind> {
    objc2::rc::autoreleasepool(|_| {
      let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
      let id = app.bundleIdentifier()?.to_string();
      if let Some(kind) = kind_from_table(&id) {
        return Some(kind);
      }
      let url = app.bundleURL()?;
      let bundle = NSBundle::bundleWithURL(&url)?;
      let value = bundle.objectForInfoDictionaryKey(&NSString::from_str("LSApplicationCategoryType"))?;
      let category = value.downcast::<NSString>().ok()?.to_string();
      Some(kind_from_category(&category))
    })
  };
  std::panic::catch_unwind(read).ok().flatten().unwrap_or(AppKind::Other)
}

#[cfg(not(target_os = "macos"))]
pub fn frontmost_kind() -> AppKind {
  AppKind::Other
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn table_and_categories() {
    assert_eq!(kind_from_table("com.apple.mail"), Some(AppKind::Writing));
    assert_eq!(kind_from_table("com.jetbrains.intellij"), Some(AppKind::Code));
    assert_eq!(kind_from_table("com.google.Chrome"), Some(AppKind::Browser));
    assert_eq!(kind_from_table("com.google.Chrome.canary"), None, "exact ids match exactly");
    assert_eq!(kind_from_table("com.valvesoftware.steam"), Some(AppKind::Game));
    assert_eq!(kind_from_table("org.example.unknown"), None);
    assert_eq!(kind_from_category("public.app-category.action-games"), AppKind::Game);
    assert_eq!(kind_from_category("public.app-category.games"), AppKind::Game);
    assert_eq!(kind_from_category("public.app-category.productivity"), AppKind::Other);
  }

  /// Reads the real frontmost app on this computer (no permission). Run by hand:
  /// cargo test --manifest-path src-tauri/Cargo.toml frontmost_reads -- --ignored --nocapture
  #[test]
  #[ignore]
  fn frontmost_reads_without_a_permission() {
    let kind = frontmost_kind();
    println!("frontmost kind: {}", kind.as_str());
  }
}
