import 'package:flutter/material.dart';

import '../../app.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/controllers/account_controller.dart';

/// Shown right after sign-up: gender, height, weight and favorite colors.
///
/// This step is compulsory. Skip and the system back button keep the user on
/// this page and say what is missing; only Continue (gender + at least one
/// favorite color) leads to Home. Height and weight are required too.
///
/// The values are stored in the user's profile through the existing
/// style-profile endpoint, so the recommendations can use them right away
/// (gender decides which pieces are shown). Continue goes straight to Home.
class BodyProfileScreen extends StatefulWidget {
  const BodyProfileScreen._(this._accountController);

  factory BodyProfileScreen({Key? key, AccountController? accountController}) {
    return BodyProfileScreen._(
      accountController ?? AppState.instance.accountController,
    );
  }

  final AccountController _accountController;

  @override
  State<BodyProfileScreen> createState() => _BodyProfileScreenState();
}

class _BodyProfileScreenState extends State<BodyProfileScreen> {
  final _height = TextEditingController();
  final _weight = TextEditingController();
  String? _gender; // 'male' | 'female'
  final Set<String> _colors = {};
  static const _colorOptions = [
    'Black', 'White', 'Beige', 'Cream', 'Navy', 'Blue', 'Denim', 'Grey',
    'Charcoal', 'Brown', 'Tan', 'Green', 'Olive', 'Red', 'Burgundy', 'Pink',
    'Purple', 'Yellow', 'Orange', 'Multicolor',
  ];
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _height.dispose();
    _weight.dispose();
    super.dispose();
  }

  void _home() {
    Navigator.of(context).pushNamedAndRemoveUntil(Routes.shell, (_) => false);
  }

  int? _num(TextEditingController c, int min, int max) {
    final v = int.tryParse(c.text.trim());
    if (v == null || v < min || v > max) return null;
    return v;
  }

  void _skip() {
    setState(() => _error =
        'This step is needed so we can suggest the right outfits. Pick your gender, enter height and weight, and choose at least one color, then tap Continue.');
  }

  Future<void> _continue() async {
    if (_saving) return;
    if (_gender == null) {
      setState(() => _error = 'Please choose male or female.');
      return;
    }
    if (_colors.isEmpty) {
      setState(() => _error = 'Please pick at least one favorite color.');
      return;
    }
    final height = _num(_height, 90, 250);
    final weight = _num(_weight, 25, 300);
    if (height == null) {
      setState(() => _error = 'Please enter your height in cm (90 to 250).');
      return;
    }
    if (weight == null) {
      setState(() => _error = 'Please enter your weight in kg (25 to 300).');
      return;
    }
    final current = widget._accountController.profile;
    if (current == null) {
      setState(() => _error = 'Your session expired. Please sign in again.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final saved = await widget._accountController.saveStyleProfile(
      current.copyWith(
        gender: _gender,
        heightCm: height,
        weightKg: weight,
        favoriteColors: _colors.toList(),
      ),
    );
    if (!mounted) return;
    if (saved == null) {
      setState(() {
        _saving = false;
        _error = 'Could not save. Check your connection and try again.';
      });
      return;
    }
    _home();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: SwScreen(
      scroll: true,
      padding: const EdgeInsets.all(Insets.gutter),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: _saving ? null : _skip,
              child: Text('Skip', style: AppText.label),
            ),
          ),
          const SizedBox(height: Insets.lg),
          Text('Tell us about you', style: AppText.h1),
          const SizedBox(height: Insets.sm),
          Text(
            'This helps us show outfits that suit you. You can change it any time in your profile.',
            style: AppText.body,
          ),
          const SizedBox(height: Insets.xl),
          Text('Gender', style: AppText.label),
          const SizedBox(height: Insets.sm),
          Wrap(
            spacing: Insets.sm,
            children: [
              SwChip(
                label: 'Male',
                selected: _gender == 'male',
                onTap: () => setState(() => _gender = 'male'),
              ),
              SwChip(
                label: 'Female',
                selected: _gender == 'female',
                onTap: () => setState(() => _gender = 'female'),
              ),
            ],
          ),
          const SizedBox(height: Insets.xl),
          TextField(
            controller: _height,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Height (cm) *'),
          ),
          const SizedBox(height: Insets.md),
          TextField(
            controller: _weight,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Weight (kg) *'),
          ),
          if (_error != null) ...[
            const SizedBox(height: Insets.md),
            Text(_error!, style: AppText.body.copyWith(color: AppColors.danger)),
          ],
          const SizedBox(height: Insets.xl),
          Text('Favorite colors', style: AppText.label),
          const SizedBox(height: Insets.sm),
          Wrap(
            spacing: Insets.sm,
            runSpacing: Insets.sm,
            children: [
              for (final color in _colorOptions)
                SwChip(
                  label: color,
                  selected: _colors.contains(color),
                  tone: SwChipTone.tinted,
                  dense: true,
                  onTap: () => setState(() {
                    _colors.contains(color)
                        ? _colors.remove(color)
                        : _colors.add(color);
                  }),
                ),
            ],
          ),
          const SizedBox(height: Insets.xl),
          SwButton(
            label: _saving ? 'Saving…' : 'Continue',
            onTap: _saving ? null : _continue,
          ),
        ],
      ),
    ),
    );
  }
}
