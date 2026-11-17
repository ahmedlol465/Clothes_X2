import 'package:flutter/material.dart';

import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/models.dart';

/// Screen for the Fashion Critic experience: evaluating an outfit rather
/// than building one. Distinct from the Stylist — honest feedback on color
/// coordination, compatibility, style consistency, balance, and concrete
/// improvement suggestions.
class FashionCriticScreen extends StatefulWidget {
  const FashionCriticScreen({super.key});

  @override
  State<FashionCriticScreen> createState() => _FashionCriticScreenState();
}

class _FashionCriticScreenState extends State<FashionCriticScreen> {
  final List<String> _selectedItemIds = [];
  bool _streaming = false;
  String? _critiqueText;
  int? _score;
  final List<String> _strengths = [];
  final List<String> _weaknesses = [];
  final List<String> _suggestions = [];
  String? _errorMessage;

  bool get _hasOutfit => _selectedItemIds.isNotEmpty;

  Future<void> _evaluateOutfit() async {
    if (!_hasOutfit || _streaming) return;
    setState(() {
      _streaming = true;
      _errorMessage = null;
      _critiqueText = null;
      _score = null;
      _strengths.clear();
      _weaknesses.clear();
      _suggestions.clear();
    });

    try {
      final res = await AppState.instance.api.critique(
        itemIds: _selectedItemIds,
        history: AppState.instance.chatHistory(),
        conversationId: AppState.instance.conversationId,
      );

      if (!mounted) return;
      setState(() {
        _streaming = false;
        _critiqueText = res['text'] as String?;
        _score = (res['score'] as num?)?.toInt();
        _strengths
          ..clear()
          ..addAll(List<String>.from((res['strengths'] as List? ?? const [])));
        _weaknesses
          ..clear()
          ..addAll(List<String>.from((res['weaknesses'] as List? ?? const [])));
        _suggestions
          ..clear()
          ..addAll(List<String>.from((res['suggestions'] as List? ?? const [])));
        _errorMessage = res['error'] as String?;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _streaming = false;
        _errorMessage = 'Critique unavailable: $e';
      });
    }
  }

  void _toggleItem(String itemId) {
    setState(() {
      if (_selectedItemIds.contains(itemId)) {
        _selectedItemIds.remove(itemId);
      } else {
        _selectedItemIds.add(itemId);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final liveItems = AppState.instance.wardrobe;

    return SwScreen(
      scroll: true,
      padding: const EdgeInsets.fromLTRB(Insets.gutter, 0, Insets.gutter, Insets.xxl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(Insets.gutter, Insets.sm, Insets.gutter, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const SwIconBadge(icon: SwIcon.star, circle: true, size: 44),
                    const SizedBox(width: Insets.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Fashion Critic', style: AppText.h1),
                          const SizedBox(height: 2),
                          Text(
                            'Honest feedback on your outfit — color, compatibility, '
                            'style, balance. Pick pieces from your wardrobe to evaluate.',
                            style: AppText.caption,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: Insets.lg),
          if (!_hasOutfit) ...[
            _SectionTitle('Choose pieces to evaluate'),
            const SizedBox(height: Insets.sm),
            Text(
              'Tap up to 5 items from your wardrobe. The Critic will evaluate '
              'the combination as one outfit.',
              style: AppText.caption,
            ),
            const SizedBox(height: Insets.md),
            if (liveItems.isEmpty)
              const Center(
                child: Text('Your wardrobe is empty. Add items first.'),
              )
            else
              Wrap(
                spacing: Insets.sm,
                runSpacing: Insets.sm,
                children: [
                  for (final item in liveItems.take(20))
                    _ItemChip(
                      item: item,
                      selected: _selectedItemIds.contains(item.id),
                      onTap: () => _toggleItem(item.id),
                    ),
                ],
              ),
            if (_selectedItemIds.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: Insets.md),
                child: Row(
                  children: [
                    Text(
                      '${_selectedItemIds.length} selected',
                      style: AppText.caption,
                    ),
                    const Spacer(),
                    SwButton(
                      label: 'Critique',
                      onTap: _evaluateOutfit,
                      expand: false,
                    ),
                  ],
                ),
              ),
          ] else ...[
            _SectionTitle('Critique result', showLoading: _streaming),
            const SizedBox(height: Insets.sm),
            if (_errorMessage != null)
              SwCard(
                padding: const EdgeInsets.all(Insets.lg),
                child: Text(
                  _errorMessage!,
                  style: AppText.caption.copyWith(color: AppColors.danger),
                ),
              )
            else if (_critiqueText != null) ...[
              _ScoreCard(score: _score),
              const SizedBox(height: Insets.md),
              _SectionTitle('Strengths'),
              const SizedBox(height: Insets.sm),
              ..._strengths.map((s) => _Bullet(text: s)),
              const SizedBox(height: Insets.lg),
              _SectionTitle('Weaknesses'),
              const SizedBox(height: Insets.sm),
              ..._weaknesses.map((s) => _Bullet(text: s)),
              const SizedBox(height: Insets.lg),
              _SectionTitle('Suggestions'),
              const SizedBox(height: Insets.sm),
              ..._suggestions.map((s) => _Bullet(text: s)),
              const SizedBox(height: Insets.lg),
              _SectionTitle('Evaluated pieces'),
              const SizedBox(height: Insets.sm),
              Wrap(
                spacing: Insets.sm,
                runSpacing: Insets.sm,
                children: [
                  for (final id in _selectedItemIds)
                    _ItemChip(
                      item: liveItems.firstWhere((i) => i.id == id),
                      selected: true,
                      onTap: () => _toggleItem(id),
                    ),
                ],
              ),
            ],
          ],
          const SizedBox(height: Insets.xl),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title, {this.showLoading = false});
  final String title;
  final bool showLoading;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        if (showLoading)
          const SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        else
          const SizedBox(width: 16),
        const SizedBox(width: 8),
        Text(title, style: AppText.cardTitle),
      ],
    );
  }
}

class _ScoreCard extends StatelessWidget {
  const _ScoreCard({this.score});
  final int? score;

  @override
  Widget build(BuildContext context) {
    final s = score ?? 0;
    final color = s >= 75
        ? AppColors.success
        : s >= 55
            ? AppColors.sun
            : AppColors.danger;
    return SwCard(
      padding: const EdgeInsets.all(Insets.lg),
      child: Row(
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.15),
              shape: BoxShape.circle,
            ),
            child: Center(
              child: Text(
                '$s',
                style: AppText.numeric.copyWith(color: color),
              ),
            ),
          ),
          const SizedBox(width: Insets.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Critic score', style: AppText.caption),
                const SizedBox(height: 2),
                Text(
                  s >= 75
                      ? 'Strong look'
                      : s >= 55
                          ? 'Solid with room to improve'
                          : 'Needs work',
                  style: AppText.bodyStrong,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Bullet extends StatelessWidget {
  const _Bullet({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: Insets.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('• ', style: AppText.caption.copyWith(color: AppColors.primary)),
          Expanded(child: Text(text, style: AppText.body)),
        ],
      ),
    );
  }
}

class _ItemChip extends StatelessWidget {
  const _ItemChip({
    required this.item,
    required this.selected,
    required this.onTap,
  });
  final ClothingItem item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return FilterChip(
      avatar: item.image.isNotEmpty
          ? CircleAvatar(
              radius: 12,
              backgroundImage: NetworkImage(item.image),
            )
          : null,
      label: Text(item.name, style: AppText.caption),
      selected: selected,
      onSelected: (_) => onTap(),
      backgroundColor: AppColors.surface,
      selectedColor: AppColors.tint,
      checkmarkColor: AppColors.primary,
    );
  }
}