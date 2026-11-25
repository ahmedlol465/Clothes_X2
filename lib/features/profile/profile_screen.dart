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
import '../../data/controllers/account_controller.dart';
import 'profile_settings_screens.dart';
import 'widgets.dart';

/// Frame 24 - account, style blueprint and app settings.
///
/// Every value on this screen is read from the authenticated backend user
/// (`GET /users/me`). There is no mock fallback: while the request is in
/// flight a skeleton is shown, and a failure renders an error card with a
/// retry rather than inventing a profile.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen._(this._accountController);

  factory ProfileScreen({Key? key, AccountController? accountController}) {
    return ProfileScreen._(
      accountController ?? AppState.instance.accountController,
    );
  }

  final AccountController _accountController;

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
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
  }

  Future<void> _refresh() async {
    if (!mounted) return;
    await widget._accountController.loadProfile();
  }

  /// Opens the style profile editor.
  ///
  /// No refresh is needed on return: a successful save already writes the new
  /// profile into [AppState], which this screen listens to, and backing out
  /// without saving leaves [AppState] untouched. Re-fetching here would only
  /// flash the loading skeleton over data the user is looking at.
  /// Three-dots menu in the header: quick access to the profile actions.
  void _openMoreMenu(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) {
        Widget entry(String label, VoidCallback onTap) => ListTile(
              title: Text(label, style: AppText.bodyStrong),
              trailing: const SwIconView(
                SwIcon.chevronRight,
                size: 16,
                color: AppColors.textTertiary,
              ),
              onTap: () {
                Navigator.of(sheetContext).pop();
                onTap();
              },
            );
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: Insets.md),
              entry('My Style Profile', _openStyleProfile),
              entry(
                'AI Stylist Settings',
                () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const StylistSettingsScreen(),
                  ),
                ),
              ),
              entry(
                'Notifications',
                () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const NotificationSettingsScreen(),
                  ),
                ),
              ),
              entry(
                'Privacy',
                () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const PrivacySettingsScreen(),
                  ),
                ),
              ),
              const SizedBox(height: Insets.md),
            ],
          ),
        );
      },
    );
  }

  void _openStyleProfile() {
    Navigator.of(context).pushNamed(Routes.styleProfile);
  }

  void _openComingSoon({
    required String title,
    required String subtitle,
    required SwIcon icon,
  }) {
    Navigator.of(context).pushNamed(
      Routes.comingSoon,
      arguments: {
        'title': title,
        'subtitle': subtitle,
        'icon': icon,
      },
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
            SheetOption(
              icon: SwIcon.image,
              label: 'Choose from Gallery',
              onTap: () => Navigator.of(sheetContext).pop(ImageSource.gallery),
            ),
            SheetOption(
              icon: SwIcon.camera,
              label: 'Take a Photo',
              onTap: () => Navigator.of(sheetContext).pop(ImageSource.camera),
            ),
            SheetOption(
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

    final saved = await widget._accountController.uploadAvatar(
      filename: file.name.isEmpty ? 'avatar.jpg' : file.name,
      bytes: bytes,
      mimeType: _mimeFor(file),
    );
    if (!mounted) return;
    if (saved == null) {
      _toast(
        context,
        widget._accountController.profileError ?? 'Upload failed. Your picture was not changed.',
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
      listenable: widget._accountController,
      builder: (context, _) {
        final state = widget._accountController;
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
                      onTap: () => _openMoreMenu(context),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: Insets.lg),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
                child: profile == null
                    ? ProfilePlaceholder(
                        loading: state.profileLoading || !state.profileSettled,
                        message: state.profileError,
                        onRetry: _refresh,
                      )
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          IdentityCard(
                            profile: profile,
                            onChangePhoto: _changePhoto,
                          ),
                          const SizedBox(height: Insets.lg),
                          StyleBlueprintCard(
                            profile: profile,
                            onEdit: _openStyleProfile,
                            onDna: () => Navigator.of(context).pushNamed(Routes.styleDna),
                          ),
                          const SizedBox(height: Insets.xl),
                          Text('ACCOUNT', style: AppText.overline),
                          const SizedBox(height: Insets.md),
                          SettingsGroup(
                            rows: [
                              SettingRow(
                                icon: SwIcon.user,
                                title: 'My Style Profile',
                                subtitle: 'Body details, preferences',
                                onTap: _openStyleProfile,
                              ),
                              SettingRow(
                                icon: SwIcon.sparkle,
                                title: 'AI Stylist Settings',
                                subtitle: 'Modify tone and response type',
                                onTap: () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) =>
                                        const StylistSettingsScreen(),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: Insets.xl),
                          Text('INSIGHTS', style: AppText.overline),
                          const SizedBox(height: Insets.md),
                          SettingsGroup(
                            rows: [
                              SettingRow(
                                icon: SwIcon.chart,
                                title: 'Wardrobe Insights',
                                subtitle: 'What you wear and what you skip',
                                onTap: () => Navigator.of(context).pushNamed(Routes.wardrobeInsights),
                              ),
                              SettingRow(
                                icon: SwIcon.bag,
                                title: 'Smart Shopping',
                                subtitle: 'Fill your wardrobe gaps',
                                onTap: () => Navigator.of(context).pushNamed(Routes.smartShopping),
                              ),
                            ],
                          ),
                          const SizedBox(height: Insets.xl),
                          Text('APP SETTINGS', style: AppText.overline),
                          const SizedBox(height: Insets.md),
                          SettingsGroup(
                            rows: [
                              SettingRow(
                                icon: SwIcon.circleInfo,
                                title: 'Notifications',
                                subtitle: 'Reminders and tips',
                                onTap: () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) =>
                                        const NotificationSettingsScreen(),
                                  ),
                                ),
                              ),
                              SettingRow(
                                icon: SwIcon.box,
                                title: 'Privacy',
                                subtitle:
                                    'Data storage & model training options',
                                onTap: () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) =>
                                        const PrivacySettingsScreen(),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: Insets.lg),
                          LogoutButton(),
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