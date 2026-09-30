import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../app.dart';
import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/assets.dart';
import '../../data/models.dart';
import '../insights/style_dna_screen.dart';
import '../insights/wardrobe_insights_screen.dart';
import '../shop/smart_shopping_screen.dart';
import 'coming_soon_screen.dart';
import 'style_profile_screen.dart';

/// Frame 24 - account, style blueprint and app settings.
///
/// Every value on this screen is read from the authenticated backend user
/// (`GET /users/me`). There is no mock fallback: while the request is in
/// flight a skeleton is shown, and a failure renders an error card with a
/// retry rather than inventing a profile.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  /// Matches the backend's 10MB multer limit. Checked client side too, so an
  /// oversized photo fails fast instead of dying mid-upload.
  static const int _maxAvatarBytes = 10 * 1024 * 1024;

  @override
  void initState() {
    super.initState();
    // Fetch after the first frame so the screen paints its chrome immediately.
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
  }

  Future<void> _refresh() async {
    if (!mounted) return;
    await AppState.instance.loadProfile();
  }

  /// Opens the style profile editor.
  ///
  /// No refresh is needed on return: a successful save already writes the new
  /// profile into [AppState], which this screen listens to, and backing out
  /// without saving leaves [AppState] untouched. Re-fetching here would only
  /// flash the loading skeleton over data the user is looking at.
  void _openStyleProfile() {
    Navigator.of(context).push(
      MaterialPageRoute<bool>(builder: (_) => const StyleProfileScreen()),
    );
  }

  void _openComingSoon({
    required String title,
    required String subtitle,
    required SwIcon icon,
  }) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) =>
            ComingSoonScreen(title: title, subtitle: subtitle, icon: icon),
      ),
    );
  }

  /// Tapping the avatar: pick a source, preview, then upload.
  ///
  /// The picker's cancel is a silent no-op, and nothing is written locally
  /// until the backend has confirmed the upload, so a failure always leaves the
  /// previous picture untouched.
  Future<void> _changePhoto() async {
    final source = await _askPhotoSource();
    if (source == null || !mounted) return;

    final XFile? picked;
    try {
      picked = await ImagePicker().pickImage(
        source: source,
        // Downscaled and re-encoded before upload: keeps avatars small without
        // needing a backend image library. Matches the Add Clothes flow.
        maxWidth: 1024,
        maxHeight: 1024,
        imageQuality: 85,
      );
    } catch (e) {
      if (!mounted) return;
      _toast(
        context,
        source == ImageSource.camera
            ? 'Camera unavailable on this device.'
            : 'Could not open your photos.',
        error: true,
      );
      return;
    }
    if (picked == null || !mounted) return;

    final confirmed = await _confirmPhoto(picked);
    if (confirmed != true || !mounted) return;
    await _uploadPhoto(picked);
  }

  /// Gallery / Camera / Cancel sheet.
  Future<ImageSource?> _askPhotoSource() {
    return showModalBottomSheet<ImageSource>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: Insets.sm),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.border,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: Insets.md),
            _SheetOption(
              icon: SwIcon.image,
              label: 'Choose from Gallery',
              onTap: () => Navigator.of(sheetContext).pop(ImageSource.gallery),
            ),
            _SheetOption(
              icon: SwIcon.camera,
              label: 'Take a Photo',
              onTap: () => Navigator.of(sheetContext).pop(ImageSource.camera),
            ),
            _SheetOption(
              icon: SwIcon.close,
              label: 'Cancel',
              onTap: () => Navigator.of(sheetContext).pop(),
            ),
            const SizedBox(height: Insets.sm),
          ],
        ),
      ),
    );
  }

  /// Preview of the chosen image with Cancel / Save.
  Future<bool> _confirmPhoto(XFile file) async {
    final preview = await _readPreview(file);
    if (!mounted) return false;
    if (preview == null) {
      _toast(context, 'That file could not be read as an image.', error: true);
      return false;
    }
    return await showDialog<bool>(
          context: context,
          builder: (dialogContext) => Dialog(
            backgroundColor: AppColors.surface,
            insetPadding: const EdgeInsets.all(Insets.xl),
            child: Padding(
              padding: const EdgeInsets.all(Insets.lg),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('New Profile Picture', style: AppText.h4),
                  const SizedBox(height: Insets.md),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(14),
                    child: Image.memory(
                      preview,
                      width: 190,
                      height: 190,
                      fit: BoxFit.cover,
                    ),
                  ),
                  const SizedBox(height: Insets.lg),
                  Row(
                    children: [
                      Expanded(
                        child: SwOutlineButton(
                          label: 'Cancel',
                          onTap: () => Navigator.of(dialogContext).pop(false),
                        ),
                      ),
                      const SizedBox(width: Insets.sm),
                      Expanded(
                        child: FilledButton(
                          onPressed: () => Navigator.of(dialogContext).pop(true),
                          style: FilledButton.styleFrom(
                            backgroundColor: AppColors.primary,
                            padding: const EdgeInsets.symmetric(
                              vertical: Insets.md,
                            ),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                          child: const Text('Save'),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ) ??
        false;
  }

  /// Uploads, then reports the backend's real outcome.
  Future<void> _uploadPhoto(XFile file) async {
    final bytes = await _readPreview(file);
    if (bytes == null) {
      if (mounted) _toast(context, 'That file could not be read.', error: true);
      return;
    }
    if (!mounted) return;
    if (bytes.lengthInBytes > _maxAvatarBytes) {
      _toast(context, 'Image is too large. Please pick a smaller one.', error: true);
      return;
    }

    final saved = await AppState.instance.uploadAvatar(
      filename: file.name.isEmpty ? 'avatar.jpg' : file.name,
      bytes: bytes,
      mimeType: _mimeFor(file),
    );
    if (!mounted) return;
    if (saved == null) {
      // The old picture is still in place; say so rather than implying success.
      _toast(
        context,
        AppState.instance.lastError ?? 'Upload failed. Your picture was not changed.',
        error: true,
      );
      return;
    }
    _toast(context, 'Profile picture updated successfully.');
  }

  /// Reads the picked file once, guarding against an unreadable result.
  Future<Uint8List?> _readPreview(XFile file) async {
    try {
      final data = await file.readAsBytes();
      return (data.isEmpty) ? null : data;
    } catch (_) {
      return null;
    }
  }

  String _mimeFor(XFile file) {
    final t = file.mimeType;
    if (t != null && t.startsWith('image/')) return t;
    final ext = file.name.toLowerCase();
    if (ext.endsWith('.png')) return 'image/png';
    if (ext.endsWith('.webp')) return 'image/webp';
    if (ext.endsWith('.heic')) return 'image/heic';
    return 'image/jpeg';
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: AppState.instance,
      builder: (context, _) {
        final state = AppState.instance;
        final profile = state.profile;

        return SwScreen(
          scroll: true,
          padding: const EdgeInsets.only(bottom: Insets.xxl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  Insets.gutter,
                  Insets.sm,
                  Insets.gutter,
                  0,
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('My Profile', style: AppText.h1),
                          const SizedBox(height: 2),
                          Text(
                            'Manage your style blueprint',
                            style: AppText.caption,
                          ),
                        ],
                      ),
                    ),
                    SwIconButton(
                      icon: SwIconButtonKind.more,
                      onTap: () => _toast(context, 'Nothing else to manage yet.'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: Insets.lg),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
                child: profile == null
                    // Error / signed-out state, or the first-frame gap before
                    // the fetch resolves.
                    ? _ProfilePlaceholder(
                        loading: state.profileLoading || !state.profileSettled,
                        message: state.profileError,
                        onRetry: _refresh,
                      )
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _IdentityCard(
                            profile: profile,
                            onChangePhoto: _changePhoto,
                          ),
                          const SizedBox(height: Insets.lg),
                          _StyleBlueprintCard(
                            profile: profile,
                            onEdit: _openStyleProfile,
                            onDna: () => Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => const StyleDnaScreen(),
                              ),
                            ),
                          ),
                          const SizedBox(height: Insets.xl),
                          Text('ACCOUNT', style: AppText.overline),
                          const SizedBox(height: Insets.md),
                          _SettingsGroup(
                            rows: [
                              _SettingRow(
                                icon: SwIcon.user,
                                title: 'My Style Profile',
                                subtitle: 'Body details, preferences',
                                onTap: _openStyleProfile,
                              ),
                              _SettingRow(
                                icon: SwIcon.sparkle,
                                title: 'AI Stylist Settings',
                                subtitle: 'Modify tone and response type',
                                onTap: () => _openComingSoon(
                                  title: 'AI Stylist Settings',
                                  subtitle:
                                      'Tone and response preferences are '
                                      'coming soon.',
                                  icon: SwIcon.sparkle,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: Insets.xl),
                          Text('INSIGHTS', style: AppText.overline),
                          const SizedBox(height: Insets.md),
                          _SettingsGroup(
                            rows: [
                              _SettingRow(
                                icon: SwIcon.chart,
                                title: 'Wardrobe Insights',
                                subtitle: 'What you wear and what you skip',
                                onTap: () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) =>
                                        const WardrobeInsightsScreen(),
                                  ),
                                ),
                              ),
                              _SettingRow(
                                icon: SwIcon.bag,
                                title: 'Smart Shopping',
                                subtitle: 'Fill your wardrobe gaps',
                                onTap: () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) => const SmartShoppingScreen(),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: Insets.xl),
                          Text('APP SETTINGS', style: AppText.overline),
                          const SizedBox(height: Insets.md),
                          _SettingsGroup(
                            rows: [
                              _SettingRow(
                                icon: SwIcon.circleInfo,
                                title: 'Notifications',
                                subtitle: 'Reminders and tips',
                                onTap: () => _openComingSoon(
                                  title: 'Notifications',
                                  subtitle:
                                      'Reminders and styling tips are coming '
                                      'soon.',
                                  icon: SwIcon.circleInfo,
                                ),
                              ),
                              _SettingRow(
                                icon: SwIcon.box,
                                title: 'Privacy',
                                subtitle:
                                    'Data storage & model training options',
                                onTap: () => _openComingSoon(
                                  title: 'Privacy',
                                  subtitle:
                                      'Data storage and model training '
                                      'options are coming soon.',
                                  icon: SwIcon.box,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: Insets.lg),
                          const _LogoutButton(),
                        ],
                      ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// Name, email and registration date of the signed-in account.
class _IdentityCard extends StatelessWidget {
  const _IdentityCard({
    required this.profile,
    required this.onChangePhoto,
  });

  final UserProfile profile;
  final VoidCallback onChangePhoto;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      padding: const EdgeInsets.all(Insets.lg),
      child: Row(
        children: [
          _ProfileAvatar(
            profile: profile,
            busy: AppState.instance.avatarUploading,
            onTap: onChangePhoto,
          ),
          const SizedBox(width: Insets.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  profile.name,
                  style: AppText.h4,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  profile.email,
                  style: AppText.caption,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                // "Member since Sep 2026" is formatted from the backend
                // createdAt; it is never hardcoded.
                Text(
                  profile.memberSince ?? 'Member since —',
                  style: AppText.caption,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Backend avatar when one is set, the bundled photo otherwise, and the
/// account initials when neither is available.
///
/// Tapping opens the change-picture flow. While an upload is in flight the
/// previous image stays visible behind a spinner, so the user can see what is
/// still saved.
class _ProfileAvatar extends StatelessWidget {
  const _ProfileAvatar({
    required this.profile,
    required this.onTap,
    required this.busy,
  });

  final UserProfile profile;
  final VoidCallback onTap;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    const size = 56.0;
    final remote = profile.avatarUrl;
    final fallback = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      color: AppColors.tint,
      child: Text(
        profile.initials,
        style: AppText.cardTitle.copyWith(color: AppColors.primary),
      ),
    );

    return Semantics(
      button: true,
      label: 'Change profile picture',
      child: InkWell(
        onTap: busy ? null : onTap,
        customBorder: const CircleBorder(),
        child: Stack(
          alignment: Alignment.center,
          children: [
            ClipOval(
              child: remote != null
                  ? Image.network(
                      remote,
                      width: size,
                      height: size,
                      fit: BoxFit.cover,
                      // A failed load must never blank the avatar: fall back to
                      // the bundled photo, then the initials.
                      errorBuilder: (context, _, _) => Image.asset(
                        Img.avatarKarim,
                        width: size,
                        height: size,
                        fit: BoxFit.cover,
                        errorBuilder: (context, _, _) => fallback,
                      ),
                    )
                  : Image.asset(
                      Img.avatarKarim,
                      width: size,
                      height: size,
                      fit: BoxFit.cover,
                      errorBuilder: (context, _, _) => fallback,
                    ),
            ),
            if (busy)
              Container(
                width: size,
                height: size,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.black.withValues(alpha: 0.45),
                ),
                child: const Center(
                  child: SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            if (!busy)
              Positioned(
                right: -2,
                bottom: -2,
                child: Container(
                  padding: const EdgeInsets.all(4),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppColors.surface,
                    border: Border.all(color: AppColors.background, width: 2),
                  ),
                  child: const SwIconView(
                    SwIcon.camera,
                    size: 12,
                    color: AppColors.primary,
                    strokeWidth: 2,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// One row of the change-picture sheet.
class _SheetOption extends StatelessWidget {
  const _SheetOption({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final SwIcon icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: Insets.lg,
          vertical: Insets.md,
        ),
        child: Row(
          children: [
            SwIconView(icon, size: 20, color: AppColors.textPrimary),
            const SizedBox(width: Insets.md),
            Text(label, style: AppText.bodyStrong),
          ],
        ),
      ),
    );
  }
}

/// Colours, preferred styles and body measurements from the backend.
class _StyleBlueprintCard extends StatelessWidget {
  const _StyleBlueprintCard({
    required this.profile,
    required this.onEdit,
    required this.onDna,
  });

  final UserProfile profile;
  final VoidCallback onEdit;
  final VoidCallback onDna;

  @override
  Widget build(BuildContext context) {
    final colors = profile.favoriteColors;
    final styles = profile.preferredStyles;
    final size = profile.sizeLabel;
    final height = profile.heightLabel;

    return SwCard(
      padding: const EdgeInsets.all(Insets.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Favorite Styling Colors',
                  style: AppText.cardTitle.copyWith(fontSize: 14),
                ),
              ),
              GestureDetector(
                onTap: onDna,
                child: Text(
                  'View DNA',
                  style: AppText.labelStrong.copyWith(color: AppColors.primary),
                ),
              ),
            ],
          ),
          const SizedBox(height: Insets.md),
          if (colors.isEmpty)
            Text('No favorite colors yet', style: AppText.caption)
          else
            Wrap(
              spacing: Insets.md,
              runSpacing: Insets.md,
              children: [
                for (final name in colors) _ColorDot(name: name),
              ],
            ),
          const SizedBox(height: Insets.lg),
          Text(
            'Styles Preferred',
            style: AppText.cardTitle.copyWith(fontSize: 14),
          ),
          const SizedBox(height: Insets.md),
          if (styles.isEmpty)
            Text('No preferred styles yet', style: AppText.caption)
          else
            Wrap(
              spacing: Insets.sm,
              runSpacing: Insets.sm,
              children: [
                for (final style in styles)
                  SwChip(label: style, dense: true, tone: SwChipTone.tinted),
              ],
            ),
          const SizedBox(height: Insets.lg),
          Text(
            'Body & Fit Specs',
            style: AppText.cardTitle.copyWith(fontSize: 14),
          ),
          const SizedBox(height: Insets.md),
          Row(
            children: [
              Expanded(
                child: _SpecTile(
                  label: 'Size',
                  value: size ?? 'Not set',
                  muted: size == null,
                ),
              ),
              SizedBox(width: Insets.md),
              Expanded(
                child: _SpecTile(
                  label: 'Height',
                  value: height ?? 'Not set',
                  muted: height == null,
                ),
              ),
            ],
          ),
          if (profile.weightLabel != null || profile.fitLabel != null) ...[
            const SizedBox(height: Insets.md),
            Row(
              children: [
                if (profile.weightLabel != null)
                  Expanded(
                    child: _SpecTile(
                      label: 'Weight',
                      value: profile.weightLabel!,
                    ),
                  ),
                if (profile.weightLabel != null && profile.fitLabel != null)
                  const SizedBox(width: Insets.md),
                if (profile.fitLabel != null)
                  Expanded(
                    child: _SpecTile(label: 'Fit', value: profile.fitLabel!),
                  ),
              ],
            ),
          ],
          const SizedBox(height: Insets.lg),
          FilledButton(
            onPressed: onEdit,
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(46),
              textStyle: AppText.button,
              shape: const RoundedRectangleBorder(
                borderRadius: Radii.pillRadius,
              ),
            ),
            child: const Text('Edit Style Profile'),
          ),
        ],
      ),
    );
  }
}

/// Swatch for one of the user's favorite colors.
class _ColorDot extends StatelessWidget {
  const _ColorDot({required this.name});

  final String name;

  /// Palette keyed by the color vocabulary the backend accepts. Falls back to
  /// a neutral swatch so an unknown value still renders as a real dot.
  static const _palette = <String, int>{
    'Black': 0xFF1E1C1A,
    'White': 0xFFFFFFFF,
    'Beige': 0xFFE8DCC8,
    'Cream': 0xFFF6F1E7,
    'Navy': 0xFF1F2A44,
    'Blue': 0xFF3D5A80,
    'Denim': 0xFF4A6FA5,
    'Grey': 0xFF9A9A9A,
    'Charcoal': 0xFF3A3A3A,
    'Brown': 0xFF6B4A2F,
    'Tan': 0xFFC8A165,
    'Green': 0xFF3E7C4F,
    'Olive': 0xFF6B7A3A,
    'Red': 0xFFC0392B,
    'Burgundy': 0xFF6E1E2E,
    'Pink': 0xFFE8A0BF,
    'Purple': 0xFF5E4B8B,
    'Yellow': 0xFFE8C547,
    'Orange': 0xFFE07A3E,
    'Multicolor': 0xFFB8A0D0,
  };

  @override
  Widget build(BuildContext context) {
    final hex = _palette[name];
    return Tooltip(
      message: name,
      child: Container(
        width: 32,
        height: 32,
        decoration: BoxDecoration(
          color: hex == null ? AppColors.tint : Color(hex),
          shape: BoxShape.circle,
          border: Border.all(color: AppColors.border),
        ),
      ),
    );
  }
}

class _SpecTile extends StatelessWidget {
  const _SpecTile({
    required this.label,
    required this.value,
    this.muted = false,
  });

  final String label;
  final String value;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(Insets.md),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: Radii.tileRadius,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: AppText.caption.copyWith(fontSize: 10)),
          const SizedBox(height: 2),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppText.bodyStrong.copyWith(
              fontSize: 13,
              color: muted ? AppColors.textTertiary : AppColors.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

/// Loading skeleton and error card shown in place of the profile blocks.
class _ProfilePlaceholder extends StatelessWidget {
  const _ProfilePlaceholder({
    required this.loading,
    required this.message,
    required this.onRetry,
  });

  final bool loading;
  final String? message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: const [
          _SkeletonBlock(height: 92),
          SizedBox(height: Insets.lg),
          _SkeletonBlock(height: 280),
        ],
      );
    }

    return SwCard(
      padding: const EdgeInsets.all(Insets.xl),
      child: Column(
        children: [
          const SwIconBadge(icon: SwIcon.alert, circle: true, size: 48),
          const SizedBox(height: Insets.lg),
          Text("Couldn't load your profile", style: AppText.h4),
          const SizedBox(height: Insets.sm),
          Text(
            // The real API error, never a fabricated profile.
            message ?? 'Something went wrong. Please try again.',
            textAlign: TextAlign.center,
            style: AppText.body,
          ),
          const SizedBox(height: Insets.xl),
          SwButton(label: 'Retry', onTap: onRetry),
        ],
      ),
    );
  }
}

/// Shimmer-free neutral placeholder block for the loading state.
class _SkeletonBlock extends StatelessWidget {
  const _SkeletonBlock({required this.height});

  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: Radii.cardRadius,
        border: Border.all(color: AppColors.border),
      ),
      child: const Center(
        child: SizedBox.square(
          dimension: 22,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      ),
    );
  }
}

/// Logout: revokes the session, clears cached state and returns to Login.
///
/// The route stack is reset with `pushNamedAndRemoveUntil`, so the shell and
/// every pushed screen are destroyed — Android back cannot return here.
class _LogoutButton extends StatelessWidget {
  const _LogoutButton();

  @override
  Widget build(BuildContext context) {
    return SwOutlineButton(
      label: 'Logout',
      foreground: AppColors.danger,
      onTap: () => _confirmLogout(context),
    );
  }

  Future<void> _confirmLogout(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(borderRadius: Radii.cardRadius),
        title: Text('Log out?', style: AppText.h4),
        content: Text(
          'You will need to sign in again to see your style profile.',
          style: AppText.body,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(
              'Cancel',
              style: AppText.bodyStrong.copyWith(
                color: AppColors.textSecondary,
              ),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(
              'Logout',
              style: AppText.bodyStrong.copyWith(color: AppColors.danger),
            ),
          ),
        ],
      ),
    );

    if (confirmed != true || !context.mounted) return;
    await AppState.instance.logout();
    if (!context.mounted) return;
    // The root navigator is required here: this screen lives inside the
    // profile tab's own Navigator, whose onGenerateRoute ignores the route name
    // and would rebuild the tab root instead of leaving the shell.
    Navigator.of(
      context,
      rootNavigator: true,
    ).pushNamedAndRemoveUntil(Routes.login, (_) => false);
  }
}

/// Grouped list of tappable settings rows.
class _SettingsGroup extends StatelessWidget {
  const _SettingsGroup({required this.rows});

  final List<_SettingRow> rows;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      padding: EdgeInsets.zero,
      clip: true,
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            rows[i],
            if (i != rows.length - 1)
              const Padding(
                padding: EdgeInsets.only(left: 52),
                child: Divider(height: 1),
              ),
          ],
        ],
      ),
    );
  }
}

class _SettingRow extends StatelessWidget {
  const _SettingRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.onTap,
  });

  final SwIcon icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(Insets.lg),
        child: Row(
          children: [
            SwIconView(icon, size: 18, color: AppColors.primary),
            const SizedBox(width: Insets.lg),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: AppText.bodyStrong.copyWith(fontSize: 14)),
                  const SizedBox(height: 1),
                  Text(subtitle, style: AppText.caption),
                ],
              ),
            ),
            const SwIconView(
              SwIcon.chevronRight,
              size: 16,
              color: AppColors.textTertiary,
            ),
          ],
        ),
      ),
    );
  }
}

void _toast(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? AppColors.danger : null,
        behavior: SnackBarBehavior.floating,
      ),
    );
}
