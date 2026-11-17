import 'package:flutter/material.dart';

import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';

/// Shopping Assistant — category-level guidance on what could complement the
/// wardrobe.
///
/// Suggestions are grounded in real wardrobe gaps or an explicit user request.
/// Each suggestion is clearly not-owned (`isOwned: false`) and is never added
/// to the wardrobe. Not live listings: no prices, merchants, availability, or
/// purchase links are claimed.
class ShoppingAssistantScreen extends StatefulWidget {
  const ShoppingAssistantScreen({super.key});

  @override
  State<ShoppingAssistantScreen> createState() => _ShoppingAssistantScreenState();
}

class _ShoppingAssistantScreenState extends State<ShoppingAssistantScreen> {
  final _state = AppState.instance;
  final _controller = TextEditingController();
  bool _asking = false;
  String? _reply;
  List<_Suggestion> _suggestions = [];
  String? _error;
  _OwnedItem? _alreadyOwned;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _ask() async {
    final q = _controller.text.trim();
    if (q.isEmpty || _asking) return;
    setState(() {
      _asking = true;
      _error = null;
      _reply = null;
      _suggestions = [];
      _controller.clear();
    });

    try {
      final res = await _state.api.shoppingAssistant(message: q);
      if (!mounted) return;
      setState(() {
        _reply = res['reply'] as String?;
        _suggestions = (res['suggestions'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => _Suggestion.fromJson(Map<String, dynamic>.from(e)))
            .toList();
        _alreadyOwned = res['alreadyOwned'] is Map
            ? _OwnedItem.fromJson(Map<String, dynamic>.from(res['alreadyOwned']))
            : null;
        _asking = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Couldn\'t reach the assistant: $e';
        _asking = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SwScreen(
      scroll: true,
      padding: const EdgeInsets.only(bottom: Insets.xxl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              Insets.gutter, Insets.sm, Insets.gutter, 0,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const SwIconBadge(
                      icon: SwIcon.shoppingCart, circle: true, size: 44,
                    ),
                    const SizedBox(width: Insets.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Shopping Assistant', style: AppText.h1),
                          const SizedBox(height: 2),
                          Text(
                            'Category-level guidance on what could complement '
                            'your wardrobe — based on real gaps, not live listings.',
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
          // Not-a-live-listing disclaimer (always shown).
          SwCard(
            padding: const EdgeInsets.all(Insets.lg),
            child: Row(
              children: [
                const SwIconBadge(icon: SwIcon.alert, size: 28, circle: true),
                const SizedBox(width: Insets.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Not a live product listing', style: AppText.cardTitle.copyWith(fontSize: 13)),
                      const SizedBox(height: 2),
                      Text(
                        'These are category-level suggestions only. No prices, '
                        'merchants, availability, or purchase links are claimed, '
                        'and nothing here is added to your wardrobe.',
                        style: AppText.caption.copyWith(color: AppColors.textTertiary),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: Insets.lg),
          // Question input.
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    style: AppText.field,
                    cursorColor: AppColors.primary,
                    decoration: InputDecoration(
                      hintText: 'What could complement my wardrobe?',
                      hintStyle: AppText.fieldHint,
                      prefixIcon: Padding(
                        padding: const EdgeInsets.only(left: Insets.lg, right: Insets.md),
                        child: SwIconView(
                          SwIcon.search, size: 18, color: AppColors.textTertiary,
                        ),
                      ),
                      prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: Insets.lg, vertical: Insets.lg,
                      ),
                    ),
                    onSubmitted: (_) => _ask(),
                  ),
                ),
                const SizedBox(width: Insets.sm),
                SwButton(
                  label: 'Ask',
                  onTap: _asking ? null : _ask,
                  expand: false,
                ),
              ],
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: Insets.md),
            SwCard(
              padding: const EdgeInsets.all(Insets.lg),
              child: Text(
                _error!,
                style: AppText.caption.copyWith(color: AppColors.danger),
              ),
            ),
          ],
          const SizedBox(height: Insets.lg),
          if (_alreadyOwned != null) ...[
            SwBanner(
              tone: SwBannerTone.warning,
              icon: SwIcon.shirt,
              message:
                  'You already own "${_alreadyOwned!.name}" '
                  '(${_alreadyOwned!.category}), so there is nothing to buy there.',
            ),
            const SizedBox(height: Insets.lg),
          ],
          if (_reply != null) ...[
            Text(_reply!, style: AppText.body),
            const SizedBox(height: Insets.lg),
          ],
          if (_suggestions.isNotEmpty) ...[
            Text('Suggestions', style: AppText.cardTitle),
            const SizedBox(height: Insets.sm),
            ..._suggestions.map((s) => Padding(
              padding: const EdgeInsets.only(bottom: Insets.md),
              child: _SuggestionCard(suggestion: s),
            )),
            const SizedBox(height: Insets.lg),
          ],
          if (_reply == null && _suggestions.isEmpty && _error == null && !_asking)
            _EmptyPrompt(),
        ],
      ),
    );
  }
}

class _Suggestion {
  _Suggestion({
    required this.category, required this.suggestion, required this.reason,
    required this.unlocks, required this.isOwned,
  });
  factory _Suggestion.fromJson(Map<String, dynamic> json) => _Suggestion(
    category: '${json['category'] ?? ''}',
    suggestion: '${json['suggestion'] ?? ''}',
    reason: '${json['reason'] ?? ''}',
    unlocks: List<String>.from((json['unlocks'] as List? ?? const [])),
    isOwned: json['isOwned'] == true,
  );
  final String category;
  final String suggestion;
  final String reason;
  final List<String> unlocks;
  final bool isOwned;
}

/// An owned item the user already has (so it is not suggested for purchase).
class _OwnedItem {
  _OwnedItem({required this.id, required this.name, required this.category});
  factory _OwnedItem.fromJson(Map<String, dynamic> json) => _OwnedItem(
    id: '${json['id'] ?? ''}',
    name: '${json['name'] ?? ''}',
    category: '${json['category'] ?? ''}',
  );
  final String id;
  final String name;
  final String category;
}

class _SuggestionCard extends StatelessWidget {
  const _SuggestionCard({required this.suggestion});
  final _Suggestion suggestion;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      padding: const EdgeInsets.all(Insets.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  suggestion.suggestion,
                  style: AppText.cardTitle,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: Insets.sm, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.tint,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  'Not owned \u2022 ${suggestion.category}',
                  style: AppText.caption.copyWith(
                    fontSize: 10, color: AppColors.textSecondary,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: Insets.md),
          Text(suggestion.reason, style: AppText.caption),
          if (suggestion.unlocks.isNotEmpty) ...[
            const SizedBox(height: Insets.sm),
            Text(
              'Unlocks: ${suggestion.unlocks.join(', ')}',
              style: AppText.caption.copyWith(
                color: AppColors.primary, fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _EmptyPrompt extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return SwCard(
      padding: const EdgeInsets.all(Insets.xl),
      child: Column(
        children: [
          const SwIconBadge(icon: SwIcon.shoppingCart, size: 48, circle: true),
          const SizedBox(height: Insets.lg),
          Text('No suggestions yet', style: AppText.h4),
          const SizedBox(height: Insets.sm),
          Text(
            'Ask what could complement your wardrobe, or add pieces first so '
            'the assistant can identify real gaps.',
            textAlign: TextAlign.center,
            style: AppText.body,
          ),
        ],
      ),
    );
  }
}
