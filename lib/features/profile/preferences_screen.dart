import 'package:flutter/material.dart';

import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/models.dart';

/// Screen for viewing and managing learned style preferences.
///
/// Lets the user see what the stylist has learned about their taste
/// (colours, styles, fabrics, formality lean, never-wears list) and
/// edit or reset individual preferences.
class PreferencesScreen extends StatefulWidget {
  const PreferencesScreen({super.key});

  @override
  State<PreferencesScreen> createState() => _PreferencesScreenState();
}

class _PreferencesScreenState extends State<PreferencesScreen> {
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    await AppState.instance.loadPreferences();
    if (mounted) setState(() => _loading = false);
  }

  LearnedPreferences? get _prefs => AppState.instance.learnedPreferences;

  Future<void> _toggleColor(String name, double current) async {
    setState(() => _saving = true);
    await AppState.instance.updatePreference(
      PreferenceUpdate(color: name, colorValue: current > 0.5 ? 0.2 : 0.8),
    );
    if (mounted) setState(() => _saving = false);
  }

  Future<void> _toggleStyle(String name, double current) async {
    setState(() => _saving = true);
    await AppState.instance.updatePreference(
      PreferenceUpdate(style: name, styleValue: current > 0.5 ? 0.2 : 0.8),
    );
    if (mounted) setState(() => _saving = false);
  }

  Future<void> _removeAvoid(String phrase) async {
    setState(() => _saving = true);
    await AppState.instance.removeAvoidItem(phrase);
    if (mounted) setState(() => _saving = false);
  }

  Future<void> _resetAll() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Reset all preferences?'),
        content: const Text(
          'This clears everything the stylist has learned about your taste. '
          'It cannot be undone.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Reset', style: TextStyle(color: AppColors.danger)),
          ),
        ],
      ),
    );
    if (ok == true && mounted) {
      setState(() => _saving = true);
      await AppState.instance.resetPreferences();
      await _load();
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final prefs = _prefs;

    return SwScreen(
      scroll: true,
      padding: const EdgeInsets.fromLTRB(Insets.gutter, 0, Insets.gutter, Insets.xxl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(Insets.gutter, Insets.sm, Insets.gutter, 0),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('My Learned Preferences', style: AppText.h1),
                      const SizedBox(height: 2),
                      Text(
                        'What the stylist has remembered about your taste. '
                        'Tap any item to flip it, or remove it entirely.',
                        style: AppText.caption,
                      ),
                    ],
                  ),
                ),
                if (!(_loading || _saving) && prefs != null)
                  TextButton(
                    onPressed: _resetAll,
                    child: const Text(
                      'Reset All',
                      style: TextStyle(color: AppColors.danger),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: Insets.lg),
          if (_loading)
            const Center(child: CircularProgressIndicator())
          else if (prefs == null)
            const Center(child: Text('Unable to load preferences.'))
          else ...[
            _SectionTitle('Colours'),
            const SizedBox(height: Insets.sm),
            ...prefs.colorPreferences.map((cp) => _ColorRow(
                  name: cp.name,
                  value: cp.value,
                  onToggle: () => _toggleColor(cp.name, cp.value),
                )),
            const SizedBox(height: Insets.lg),
            _SectionTitle('Styles'),
            const SizedBox(height: Insets.sm),
            ...prefs.stylePreferences.map((sp) => _StyleRow(
                  name: sp.name,
                  value: sp.value,
                  onToggle: () => _toggleStyle(sp.name, sp.value),
                )),
            const SizedBox(height: Insets.lg),
            _SectionTitle('Fabrics'),
            const SizedBox(height: Insets.sm),
            ...prefs.fabricPreferences.map((fp) => _FabricRow(
                  name: fp.name,
                  value: fp.value,
                )),
            const SizedBox(height: Insets.lg),
            _SectionTitle('Formality'),
            const SizedBox(height: Insets.sm),
            _FormalityRow(
              lean: prefs.formalityLean ?? 0.5,
              hasOpinion: prefs.hasFormalityOpinion,
            ),
            const SizedBox(height: Insets.lg),
            _SectionTitle('Never Wear'),
            const SizedBox(height: Insets.sm),
            if (prefs.avoid.isEmpty)
              Text(
                'No absolute exclusions. The stylist will show anything in your wardrobe.',
                style: AppText.caption,
              )
            else
              ...prefs.avoid.map((phrase) => _AvoidRow(
                    phrase: phrase,
                    onRemove: () => _removeAvoid(phrase),
                  )),
            const SizedBox(height: Insets.lg),
            _SectionTitle('Confidence'),
            const SizedBox(height: Insets.sm),
            _ConfidenceRow(
              confidence: prefs.confidence,
              totals: prefs.totals,
            ),
            const SizedBox(height: Insets.xl),
            SwCard(
              padding: const EdgeInsets.all(Insets.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Notes', style: AppText.cardTitle),
                  const SizedBox(height: Insets.sm),
                  if (prefs.facts.isEmpty)
                    Text(
                      'No learned notes yet. Chat with the stylist to teach it your taste.',
                      style: AppText.caption,
                    )
                  else
                    ...prefs.facts.take(6).map((f) => Padding(
                          padding: const EdgeInsets.only(bottom: Insets.xs),
                          child: Text('• ${f['text'] ?? ''}', style: AppText.body),
                        )),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);
  final String title;

  @override
  Widget build(BuildContext context) {
    return Text(title, style: AppText.cardTitle);
  }
}

class _ColorRow extends StatelessWidget {
  const _ColorRow({
    required this.name,
    required this.value,
    required this.onToggle,
  });
  final String name;
  final double value;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final liked = value > 0.5;
    return ListTile(
      leading: CircleAvatar(
        backgroundColor: liked ? AppColors.primary : AppColors.surface,
        child: Text(name[0].toUpperCase(), style: const TextStyle(fontSize: 14)),
      ),
      title: Text(name, style: AppText.body),
      subtitle: Text(
        liked ? 'Liked · ${(value * 100).round()}%' : 'Disliked · ${((1 - value) * 100).round()}%',
        style: AppText.caption,
      ),
      trailing: SwIconButton(
        icon: SwIconButtonKind.close,
        filled: liked,
        onTap: onToggle,
        size: 28,
      ),
      onTap: onToggle,
    );
  }
}

class _StyleRow extends StatelessWidget {
  const _StyleRow({
    required this.name,
    required this.value,
    required this.onToggle,
  });
  final String name;
  final double value;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final liked = value > 0.5;
    return ListTile(
      leading: const SwIconBadge(icon: SwIcon.shirt, circle: true, size: 32),
      title: Text(name, style: AppText.body),
      subtitle: Text(
        liked ? 'Preferred · ${(value * 100).round()}%' : 'Avoid · ${((1 - value) * 100).round()}%',
        style: AppText.caption,
      ),
      trailing: SwIconButton(
        icon: SwIconButtonKind.close,
        filled: liked,
        onTap: onToggle,
        size: 28,
      ),
      onTap: onToggle,
    );
  }
}

class _FabricRow extends StatelessWidget {
  const _FabricRow({
    required this.name,
    required this.value,
  });
  final String name;
  final double value;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const SwIconBadge(icon: SwIcon.tag, circle: true, size: 32),
      title: Text(name, style: AppText.body),
      subtitle: Text(
        '${(value * 100).round()}% match',
        style: AppText.caption,
      ),
    );
  }
}

class _FormalityRow extends StatelessWidget {
  const _FormalityRow({
    required this.lean,
    required this.hasOpinion,
  });
  final double lean;
  final bool hasOpinion;

  @override
  Widget build(BuildContext context) {
    final label = hasOpinion
        ? (lean > 0.5 ? 'Leans dressier' : 'Leans more relaxed')
        : 'No stated preference';
    return ListTile(
      leading: const SwIconBadge(icon: SwIcon.user, circle: true, size: 32),
      title: Text('Formality', style: AppText.body),
      subtitle: Text(label, style: AppText.caption),
      trailing: Text(
        '${(lean * 100).round()}%',
        style: AppText.body.copyWith(fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _AvoidRow extends StatelessWidget {
  const _AvoidRow({
    required this.phrase,
    required this.onRemove,
  });
  final String phrase;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const SwIconBadge(icon: SwIcon.close, circle: true, size: 32),
      title: Text(phrase, style: AppText.body),
      subtitle: Text('Absolute exclusion', style: AppText.caption),
      trailing: SwIconButton(
        icon: SwIconButtonKind.close,
        filled: true,
        background: AppColors.danger,
        onTap: onRemove,
        size: 28,
      ),
    );
  }
}

class _ConfidenceRow extends StatelessWidget {
  const _ConfidenceRow({
    required this.confidence,
    required this.totals,
  });
  final double confidence;
  final Map<String, dynamic> totals;

  @override
  Widget build(BuildContext context) {
    final ratings = (totals['ratings'] as num?)?.toInt() ?? 0;
    final chats = (totals['chats'] as num?)?.toInt() ?? 0;
    return ListTile(
      leading: const SwIconBadge(icon: SwIcon.chart, circle: true, size: 32),
      title: Text('Learning confidence', style: AppText.body),
      subtitle: Text(
        '${(confidence * 100).round()}% — $ratings ratings, $chats chat signals',
        style: AppText.caption,
      ),
      trailing: SizedBox(
        width: 100,
        height: 6,
        child: LinearProgressIndicator(
          value: confidence.clamp(0.0, 1.0),
          backgroundColor: AppColors.surface,
          color: AppColors.primary,
        ),
      ),
    );
  }
}