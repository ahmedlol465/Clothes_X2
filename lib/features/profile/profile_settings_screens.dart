import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';

/// Real settings panels reachable from the Profile screen: AI stylist
/// preferences, notification preferences and privacy controls. Preferences
/// persist locally in SharedPreferences and are read back on every open.

Future<SharedPreferences> _prefs() => SharedPreferences.getInstance();

class _SettingsScaffold extends StatelessWidget {
  const _SettingsScaffold({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return SwScreen(
      scroll: true,
      padding: const EdgeInsets.all(Insets.gutter),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              SwIconButton(
                icon: SwIconButtonKind.back,
                onTap: () => Navigator.of(context).pop(),
              ),
              const SizedBox(width: Insets.sm),
              Expanded(child: Text(title, style: AppText.h2)),
            ],
          ),
          const SizedBox(height: Insets.xl),
          child,
        ],
      ),
    );
  }
}

class _ToggleCard extends StatelessWidget {
  const _ToggleCard({
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: Insets.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(Insets.lg),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: AppText.bodyStrong.copyWith(fontSize: 14)),
                  const SizedBox(height: 2),
                  Text(subtitle, style: AppText.caption),
                ],
              ),
            ),
            Switch(
              value: value,
              activeColor: AppColors.primary,
              onChanged: onChanged,
            ),
          ],
        ),
      ),
    );
  }
}

class _ChoiceSection extends StatelessWidget {
  const _ChoiceSection({
    required this.title,
    required this.options,
    required this.selected,
    required this.onSelect,
  });

  final String title;
  final List<(String, String)> options; // (value, label)
  final String selected;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: AppText.label),
        const SizedBox(height: Insets.sm),
        Wrap(
          spacing: Insets.sm,
          runSpacing: Insets.sm,
          children: [
            for (final (value, label) in options)
              SwChip(
                label: label,
                selected: selected == value,
                tone: SwChipTone.tinted,
                dense: true,
                onTap: () => onSelect(value),
              ),
          ],
        ),
      ],
    );
  }
}

// -------------------------------------------------------- stylist settings

class StylistSettingsScreen extends StatefulWidget {
  const StylistSettingsScreen({super.key});

  @override
  State<StylistSettingsScreen> createState() => _StylistSettingsScreenState();
}

class _StylistSettingsScreenState extends State<StylistSettingsScreen> {
  String _language = 'auto';
  String _length = 'balanced';
  bool _creativity = true;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final p = await _prefs();
    if (!mounted) return;
    setState(() {
      _language = p.getString('stylist_language') ?? 'auto';
      _length = p.getString('stylist_length') ?? 'balanced';
      _creativity = p.getBool('stylist_creativity') ?? true;
      _loaded = true;
    });
  }

  Future<void> _save() async {
    final p = await _prefs();
    await p.setString('stylist_language', _language);
    await p.setString('stylist_length', _length);
    await p.setBool('stylist_creativity', _creativity);
  }

  @override
  Widget build(BuildContext context) {
    return _SettingsScaffold(
      title: 'AI Stylist Settings',
      child: !_loaded
          ? const Center(
              child: CircularProgressIndicator(
                valueColor: AlwaysStoppedAnimation(AppColors.primary),
              ),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _ChoiceSection(
                  title: 'Reply language',
                  options: const [
                    ('auto', 'Auto'),
                    ('ar', 'Arabic'),
                    ('en', 'English'),
                  ],
                  selected: _language,
                  onSelect: (v) {
                    setState(() => _language = v);
                    _save();
                  },
                ),
                const SizedBox(height: Insets.xl),
                _ChoiceSection(
                  title: 'Response length',
                  options: const [
                    ('short', 'Short'),
                    ('balanced', 'Balanced'),
                    ('detailed', 'Detailed'),
                  ],
                  selected: _length,
                  onSelect: (v) {
                    setState(() => _length = v);
                    _save();
                  },
                ),
                const SizedBox(height: Insets.xl),
                _ToggleCard(
                  title: 'Creative suggestions',
                  subtitle:
                      'Let the stylist suggest pieces beyond your usual palette.',
                  value: _creativity,
                  onChanged: (v) {
                    setState(() => _creativity = v);
                    _save();
                  },
                ),
                const SizedBox(height: Insets.sm),
                Text(
                  'These preferences apply to the stylist on this device.',
                  style: AppText.caption,
                ),
              ],
            ),
    );
  }
}

// ------------------------------------------------------------- notifications

class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({super.key});

  @override
  State<NotificationSettingsScreen> createState() =>
      _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState
    extends State<NotificationSettingsScreen> {
  bool _outfitReminders = true;
  bool _weeklyInsights = true;
  bool _shoppingDeals = false;
  bool _stylistTips = true;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final p = await _prefs();
    if (!mounted) return;
    setState(() {
      _outfitReminders = p.getBool('notif_outfit_reminders') ?? true;
      _weeklyInsights = p.getBool('notif_weekly_insights') ?? true;
      _shoppingDeals = p.getBool('notif_shopping_deals') ?? false;
      _stylistTips = p.getBool('notif_stylist_tips') ?? true;
      _loaded = true;
    });
  }

  Future<void> _set(String key, bool value) async {
    final p = await _prefs();
    await p.setBool(key, value);
  }

  @override
  Widget build(BuildContext context) {
    return _SettingsScaffold(
      title: 'Notifications',
      child: !_loaded
          ? const Center(
              child: CircularProgressIndicator(
                valueColor: AlwaysStoppedAnimation(AppColors.primary),
              ),
            )
          : Column(
              children: [
                _ToggleCard(
                  title: 'Outfit reminders',
                  subtitle: 'Daily nudge with a ready outfit for today.',
                  value: _outfitReminders,
                  onChanged: (v) {
                    setState(() => _outfitReminders = v);
                    _set('notif_outfit_reminders', v);
                  },
                ),
                _ToggleCard(
                  title: 'Weekly wardrobe insights',
                  subtitle: 'A summary of what you wore and what you skipped.',
                  value: _weeklyInsights,
                  onChanged: (v) {
                    setState(() => _weeklyInsights = v);
                    _set('notif_weekly_insights', v);
                  },
                ),
                _ToggleCard(
                  title: 'Shopping deals',
                  subtitle: 'Alerts when an item on your gap list goes on sale.',
                  value: _shoppingDeals,
                  onChanged: (v) {
                    setState(() => _shoppingDeals = v);
                    _set('notif_shopping_deals', v);
                  },
                ),
                _ToggleCard(
                  title: 'Stylist tips',
                  subtitle: 'Occasional styling ideas based on your wardrobe.',
                  value: _stylistTips,
                  onChanged: (v) {
                    setState(() => _stylistTips = v);
                    _set('notif_stylist_tips', v);
                  },
                ),
              ],
            ),
    );
  }
}

// ------------------------------------------------------------------- privacy

class PrivacySettingsScreen extends StatefulWidget {
  const PrivacySettingsScreen({super.key});

  @override
  State<PrivacySettingsScreen> createState() => _PrivacySettingsScreenState();
}

class _PrivacySettingsScreenState extends State<PrivacySettingsScreen> {
  bool _saveAnalysisHistory = true;
  bool _shareAnonymousUsage = false;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final p = await _prefs();
    if (!mounted) return;
    setState(() {
      _saveAnalysisHistory = p.getBool('privacy_save_analysis') ?? true;
      _shareAnonymousUsage = p.getBool('privacy_share_usage') ?? false;
      _loaded = true;
    });
  }

  Future<void> _set(String key, bool value) async {
    final p = await _prefs();
    await p.setBool(key, value);
  }

  @override
  Widget build(BuildContext context) {
    return _SettingsScaffold(
      title: 'Privacy',
      child: !_loaded
          ? const Center(
              child: CircularProgressIndicator(
                valueColor: AlwaysStoppedAnimation(AppColors.primary),
              ),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _ToggleCard(
                  title: 'Keep analysis history',
                  subtitle:
                      'Store photo analysis results so item details can show '
                      'colors, confidence and evidence.',
                  value: _saveAnalysisHistory,
                  onChanged: (v) {
                    setState(() => _saveAnalysisHistory = v);
                    _set('privacy_save_analysis', v);
                  },
                ),
                _ToggleCard(
                  title: 'Share anonymous usage',
                  subtitle:
                      'Help improve the app with anonymous usage stats. No '
                      'photos or wardrobe data are ever shared.',
                  value: _shareAnonymousUsage,
                  onChanged: (v) {
                    setState(() => _shareAnonymousUsage = v);
                    _set('privacy_share_usage', v);
                  },
                ),
                const SizedBox(height: Insets.lg),
                Container(
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(Insets.lg),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SwIconView(
                          SwIcon.box,
                          size: 18,
                          color: AppColors.primary,
                        ),
                        const SizedBox(width: Insets.md),
                        Expanded(
                          child: Text(
                            'Your photos and wardrobe stay on your account. '
                            'Deleting an item removes it and its analysis '
                            'from the server permanently.',
                            style: AppText.caption,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}
