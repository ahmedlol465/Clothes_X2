import 'package:flutter/material.dart';

import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/models.dart';

/// "My Style Profile" — loads the authenticated user's style blueprint from
/// the backend, lets them change it, and persists it with
/// `PATCH /users/me/style-profile`.
///
/// The database is the source of truth: the form is seeded from a fresh
/// `GET /users/me`, and after saving the screen adopts the values the backend
/// echoes back rather than the values that were typed. Leaving the page,
/// restarting the app, or signing in from another device all show the same
/// saved data.
///
/// The email is displayed read-only on purpose — changing it needs a
/// verification flow that does not exist yet.
class StyleProfileScreen extends StatefulWidget {
  const StyleProfileScreen({super.key});

  @override
  State<StyleProfileScreen> createState() => _StyleProfileScreenState();
}

class _StyleProfileScreenState extends State<StyleProfileScreen> {
  static const _colorOptions = [
    'Black', 'White', 'Beige', 'Cream', 'Navy', 'Blue', 'Denim', 'Grey',
    'Charcoal', 'Brown', 'Tan', 'Green', 'Olive', 'Red', 'Burgundy', 'Pink',
    'Purple', 'Yellow', 'Orange', 'Multicolor',
  ];

  static const _styleOptions = [
    'Casual', 'Smart Casual', 'Minimalist', 'Classic', 'Vintage', 'Modern',
    'Formal', 'Elegant', 'Streetwear', 'Sporty', 'Bohemian', 'Preppy',
  ];

  static const _fitOptions = [
    ('slim', 'Slim'),
    ('regular', 'Regular'),
    ('relaxed', 'Relaxed'),
    ('oversized', 'Oversized'),
  ];

  // Mirrors the backend size vocabulary in server.js.
  static const _topSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  static const _bottomSizes = ['28', '30', '32', '34', '36', '38', '40'];
  static const _shoeSizes = ['38', '39', '40', '41', '42', '43', '44', '45'];

  final _name = TextEditingController();
  final _height = TextEditingController();
  final _weight = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  final Set<String> _colors = {};
  final Set<String> _styles = {};

  String _fit = 'regular';
  String? _top;
  String? _bottom;
  String? _shoe;

  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    _height.dispose();
    _weight.dispose();
    super.dispose();
  }

  /// Reads the authoritative profile from the backend and fills the form.
  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    final ok = await AppState.instance.loadProfile();
    if (!mounted) return;

    final profile = AppState.instance.profile;
    if (!ok || profile == null) {
      setState(() {
        _loading = false;
        _error =
            AppState.instance.profileError ?? 'Could not load your style profile.';
      });
      return;
    }

    _seed(profile);
    setState(() => _loading = false);
  }

  void _seed(UserProfile p) {
    _name.text = p.name;
    _height.text = p.heightCm?.toString() ?? '';
    _weight.text = p.weightKg?.toString() ?? '';
    _colors
      ..clear()
      ..addAll(p.favoriteColors);
    _styles
      ..clear()
      ..addAll(p.preferredStyles);
    _fit = p.fitPreference;
    _top = p.topSize;
    _bottom = p.bottomSize;
    _shoe = p.shoeSize;
  }

  void _toggle(Set<String> target, String value) {
    setState(() {
      if (!target.remove(value)) target.add(value);
    });
  }

  Future<void> _save() async {
    if (_saving) return;
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() {
      _saving = true;
      _error = null;
    });

    final current = AppState.instance.profile;
    if (current == null) {
      setState(() {
        _saving = false;
        _error = 'Your session expired. Please sign in again.';
      });
      return;
    }

    // Build the draft from the constructor rather than copyWith so a cleared
    // field (null) is sent as null instead of being treated as "unchanged".
    final draft = UserProfile(
      id: current.id,
      name: _name.text.trim(),
      email: current.email,
      createdAt: current.createdAt,
      avatarUrl: current.avatarUrl,
      favoriteColors: _colors.toList(),
      preferredStyles: _styles.toList(),
      heightCm: _intOrNull(_height.text),
      weightKg: _intOrNull(_weight.text),
      fitPreference: _fit,
      topSize: _top,
      bottomSize: _bottom,
      shoeSize: _shoe,
    );

    // Name goes through its own endpoint; the style fields through the style
    // profile endpoint. Both are scoped to the token's own account.
    UserProfile? saved = await AppState.instance.saveStyleProfile(draft);
    final nameChanged = _name.text.trim() != current.name;
    if (saved != null && nameChanged) {
      saved = await AppState.instance.updateName(_name.text.trim());
    }

    if (!mounted) return;

    if (saved == null) {
      // Nothing was persisted — say so and keep the edits on screen so the
      // user can retry instead of losing their work.
      setState(() {
        _saving = false;
        _error = 'Could not save your changes. Please try again.';
      });
      _toast(context, 'Could not save. Your changes were not stored.');
      return;
    }

    // Reflect exactly what the backend stored, in case it clamped a value.
    _seed(saved);
    setState(() => _saving = false);
    _toast(context, 'Style profile saved.');
    Navigator.of(context).pop(true);
  }

  static int? _intOrNull(String text) =>
      text.trim().isEmpty ? null : int.tryParse(text.trim());

  @override
  Widget build(BuildContext context) {
    final profile = AppState.instance.profile;

    return SwScreen(
      bottomBar: _loading || _saving
          ? null
          : _BottomBar(saving: _saving, onSave: _save),
      child: Form(
        key: _formKey,
        child: Column(
          children: [
            SwAppBar(
              title: 'My Style Profile',
              subtitle: 'Body details, preferences',
            ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null && profile == null
                      ? _ErrorState(message: _error!, onRetry: _load)
                      : _form(profile),
            ),
          ],
        ),
      ),
    );
  }

  Widget _form(UserProfile? profile) {
    return SingleChildScrollView(
      physics: const BouncingScrollPhysics(
        parent: AlwaysScrollableScrollPhysics(),
      ),
      padding: const EdgeInsets.fromLTRB(
        Insets.gutter,
        0,
        Insets.gutter,
        Insets.xxl,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_error != null) ...[
            SwBanner(
              message: _error!,
              tone: SwBannerTone.warning,
              icon: SwIcon.alert,
            ),
            const SizedBox(height: Insets.lg),
          ],
          _Section(
            title: 'ACCOUNT',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SwField(
                  label: 'Full Name',
                  controller: _name,
                  hint: 'Your name',
                  textInputAction: TextInputAction.next,
                  validator: (v) =>
                      (v == null || v.trim().isEmpty) ? 'Enter your name' : null,
                ),
                const SizedBox(height: Insets.lg),
                // Read-only: email changes require a verification flow.
                Text('Email Address', style: AppText.label),
                const SizedBox(height: Insets.sm),
                _ReadOnlyEmail(email: profile?.email ?? '—'),
              ],
            ),
          ),
          const SizedBox(height: Insets.xl),
          _Section(
            title: 'FAVORITE STYLING COLORS',
            subtitle: 'Tap to select the colors you reach for most.',
            child: Wrap(
              spacing: Insets.sm,
              runSpacing: Insets.sm,
              children: [
                for (final color in _colorOptions)
                  SwChip(
                    label: color,
                    selected: _colors.contains(color),
                    tone: SwChipTone.tinted,
                    dense: true,
                    onTap: () => _toggle(_colors, color),
                  ),
              ],
            ),
          ),
          const SizedBox(height: Insets.xl),
          _Section(
            title: 'STYLES PREFERRED',
            subtitle: 'The looks you want the stylist to build around.',
            child: Wrap(
              spacing: Insets.sm,
              runSpacing: Insets.sm,
              children: [
                for (final style in _styleOptions)
                  SwChip(
                    label: style,
                    selected: _styles.contains(style),
                    tone: SwChipTone.tinted,
                    dense: true,
                    onTap: () => _toggle(_styles, style),
                  ),
              ],
            ),
          ),
          const SizedBox(height: Insets.xl),
          _Section(
            title: 'BODY & FIT SPECS',
            child: Column(
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: SwField(
                        label: 'Height (cm)',
                        controller: _height,
                        hint: '178',
                        keyboardType: TextInputType.number,
                        validator: _heightValidator,
                      ),
                    ),
                    const SizedBox(width: Insets.md),
                    Expanded(
                      child: SwField(
                        label: 'Weight (kg)',
                        controller: _weight,
                        hint: '72',
                        keyboardType: TextInputType.number,
                        validator: _weightValidator,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: Insets.xl),
                _SizeSelector(
                  label: 'Top Size',
                  options: _topSizes,
                  value: _top,
                  onChanged: (v) => setState(() => _top = v),
                ),
                const SizedBox(height: Insets.lg),
                _SizeSelector(
                  label: 'Bottom Size',
                  options: _bottomSizes,
                  value: _bottom,
                  onChanged: (v) => setState(() => _bottom = v),
                ),
                const SizedBox(height: Insets.lg),
                _SizeSelector(
                  label: 'Shoe Size',
                  options: _shoeSizes,
                  value: _shoe,
                  onChanged: (v) => setState(() => _shoe = v),
                ),
                const SizedBox(height: Insets.xl),
                Text('Fit Preference', style: AppText.label),
                const SizedBox(height: Insets.sm),
                Wrap(
                  spacing: Insets.sm,
                  runSpacing: Insets.sm,
                  children: [
                    for (final (value, label) in _fitOptions)
                      SwChip(
                        label: label,
                        selected: _fit == value,
                        tone: SwChipTone.tinted,
                        dense: true,
                        onTap: () => setState(() => _fit = value),
                      ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: Insets.xl),
          _SaveHint(),
        ],
      ),
    );
  }

  String? _heightValidator(String? v) {
    final value = int.tryParse((v ?? '').trim());
    if ((v ?? '').trim().isEmpty) return null; // optional
    if (value == null || value < 80 || value > 250) return '80-250';
    return null;
  }

  String? _weightValidator(String? v) {
    final value = int.tryParse((v ?? '').trim());
    if ((v ?? '').trim().isEmpty) return null; // optional
    if (value == null || value < 25 || value > 300) return '25-300';
    return null;
  }
}

/// Card wrapper for one form section, matching the Profile page's section
/// headers and rounded surfaces.
class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child, this.subtitle});

  final String title;
  final String? subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: AppText.overline),
        const SizedBox(height: Insets.md),
        SwCard(child: child),
        if (subtitle != null) ...[
          const SizedBox(height: Insets.sm),
          Text(subtitle!, style: AppText.caption),
        ],
      ],
    );
  }
}

/// Single-select size row with a "clear" affordance.
class _SizeSelector extends StatelessWidget {
  const _SizeSelector({
    required this.label,
    required this.options,
    required this.value,
    required this.onChanged,
  });

  final String label;
  final List<String> options;
  final String? value;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(label, style: AppText.label),
            const Spacer(),
            if (value != null)
              GestureDetector(
                onTap: () => onChanged(null),
                child: Text(
                  'Clear',
                  style: AppText.labelStrong.copyWith(color: AppColors.primary),
                ),
              ),
          ],
        ),
        const SizedBox(height: Insets.sm),
        Wrap(
          spacing: Insets.sm,
          runSpacing: Insets.sm,
          children: [
            for (final option in options)
              SwChip(
                label: option,
                selected: value == option,
                tone: SwChipTone.tinted,
                dense: true,
                onTap: () => onChanged(value == option ? null : option),
              ),
          ],
        ),
      ],
    );
  }
}

/// Read-only email presentation, styled like a disabled input.
class _ReadOnlyEmail extends StatelessWidget {
  const _ReadOnlyEmail({required this.email});

  final String email;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: Insets.lg,
        vertical: Insets.lg,
      ),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: Radii.tileRadius,
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              email,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppText.field.copyWith(color: AppColors.textSecondary),
            ),
          ),
          const SizedBox(width: Insets.sm),
          Text(
            'Read-only',
            style: AppText.overline.copyWith(fontSize: 9),
          ),
        ],
      ),
    );
  }
}

/// Footer note explaining where the data is stored.
class _SaveHint extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SwIconView(SwIcon.circleInfo, size: 16, color: AppColors.textTertiary),
        const SizedBox(width: Insets.sm),
        Expanded(
          child: Text(
            'Your style profile is saved to your SmartWardrobe account and '
            'used by the stylist on every device.',
            style: AppText.caption,
          ),
        ),
      ],
    );
  }
}

/// Sticky Save bar. Hidden while loading or already saving.
class _BottomBar extends StatelessWidget {
  const _BottomBar({required this.saving, required this.onSave});

  final bool saving;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            Insets.gutter,
            Insets.md,
            Insets.gutter,
            Insets.md,
          ),
          child: SwButton(
            label: saving ? 'Saving…' : 'Save Changes',
            busy: saving,
            onTap: onSave,
          ),
        ),
      ),
    );
  }
}

/// Error card with a retry, shown when the profile cannot be loaded.
class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(Insets.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SwIconBadge(
              icon: SwIcon.alert,
              size: 48,
              circle: true,
            ),
            const SizedBox(height: Insets.lg),
            Text("Couldn't load your style profile", style: AppText.h4),
            const SizedBox(height: Insets.sm),
            Text(message, textAlign: TextAlign.center, style: AppText.body),
            const SizedBox(height: Insets.xl),
            SwOutlineButton(label: 'Retry', onTap: onRetry),
          ],
        ),
      ),
    );
  }
}

void _toast(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}
