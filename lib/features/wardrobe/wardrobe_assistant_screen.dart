import 'package:flutter/material.dart';

import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/models.dart';

/// Wardrobe Assistant — read-only answers about the user's actual wardrobe.
///
/// Grounded in live wardrobe records (category, color, style, season,
/// formality, timesWorn). Never creates, updates, or deletes wardrobe items.
class WardrobeAssistantScreen extends StatefulWidget {
  const WardrobeAssistantScreen({super.key});

  @override
  State<WardrobeAssistantScreen> createState() => _WardrobeAssistantScreenState();
}

class _WardrobeAssistantScreenState extends State<WardrobeAssistantScreen> {
  final _state = AppState.instance;
  final _controller = TextEditingController();
  final List<_Turn> _turns = [];
  bool _asking = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _ask() async {
    final q = _controller.text.trim();
    if (q.isEmpty || _asking) return;
    setState(() {
      _turns.add(_Turn(question: q, answer: null, asking: true));
      _asking = true;
      _error = null;
      _controller.clear();
    });

    try {
      final res = await _state.api.wardrobeAssistant(message: q);
      if (!mounted) return;
      setState(() {
        _turns.last = _Turn(question: q, answer: res['reply'] as String?);
        _itemsFound = (res['itemsFound'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => _ItemFromJson.fromJson(Map<String, dynamic>.from(e)))
            .toList();
        _gaps = (res['gaps'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => WardrobeGapEntry.fromJson(Map<String, dynamic>.from(e)))
            .toList();
        _summary = res['summary'] as Map<String, dynamic>?;
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

  List<_ItemFromJson> _itemsFound = [];
  List<WardrobeGapEntry> _gaps = [];
  Map<String, dynamic>? _summary;

  @override
  Widget build(BuildContext context) {
    final live = _state.wardrobe;

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
                      icon: SwIcon.shirt, circle: true, size: 44,
                    ),
                    const SizedBox(width: Insets.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Wardrobe Assistant', style: AppText.h1),
                          const SizedBox(height: 2),
                          Text(
                            'Ask about your closet — what you own, what you '
                            'rarely wear, and where the gaps are.',
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
                      hintText: 'What\'s in my wardrobe?',
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
          // Assistant answers.
          for (final turn in _turns.reversed) ...[
            if (turn.answer != null || turn.asking) ...[
              _AnswerBubble(
                question: turn.question,
                answer: turn.answer,
                asking: turn.asking,
              ),
              const SizedBox(height: Insets.lg),
            ],
          ],
          if (_itemsFound.isNotEmpty) ...[
            Text('Matching pieces', style: AppText.cardTitle),
            const SizedBox(height: Insets.sm),
            SizedBox(
              height: 150,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                itemCount: _itemsFound.length,
                itemBuilder: (_, i) => _ItemPreview(item: _itemsFound[i]),
              ),
            ),
            const SizedBox(height: Insets.lg),
          ],
          if (_gaps.isNotEmpty) ...[
            Text('Wardrobe gaps', style: AppText.cardTitle),
            const SizedBox(height: Insets.sm),
            ..._gaps.map((g) => Padding(
              padding: const EdgeInsets.only(bottom: Insets.xs),
              child: _Bullet(text: '${g.gap} — ${g.suggestion} (${g.reason})'),
            )),
            const SizedBox(height: Insets.lg),
          ],
          if (_summary != null && _turns.isNotEmpty) ...[
            _SummaryCard(summary: _summary!),
            const SizedBox(height: Insets.lg),
          ],
          if (live.isEmpty && _turns.isEmpty)
            _EmptyPrompt(),
        ],
      ),
    );
  }
}

class _Turn {
  _Turn({required this.question, this.answer, this.asking = false});
  final String question;
  final String? answer;
  final bool asking;
}

class _ItemFromJson {
  _ItemFromJson({
    required this.id, required this.name, required this.category,
    required this.color, required this.style, required this.timesWorn,
    required this.image,
  });
  factory _ItemFromJson.fromJson(Map<String, dynamic> json) => _ItemFromJson(
    id: '${json['id'] ?? ''}',
    name: '${json['name'] ?? ''}',
    category: '${json['category'] ?? ''}',
    color: '${json['color'] ?? ''}',
    style: '${json['style'] ?? ''}',
    timesWorn: (json['timesWorn'] as num?)?.toInt() ?? 0,
    image: '${json['image'] ?? ''}',
  );
  final String id;
  final String name;
  final String category;
  final String color;
  final String style;
  final int timesWorn;
  final String image;
}

class _AnswerBubble extends StatelessWidget {
  const _AnswerBubble({
    required this.question, required this.answer, required this.asking,
  });
  final String question;
  final String? answer;
  final bool asking;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      padding: const EdgeInsets.all(Insets.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const SwIconBadge(icon: SwIcon.user, circle: true, size: 32),
              const SizedBox(width: Insets.sm),
              Expanded(child: Text('You', style: AppText.caption)),
            ],
          ),
          const SizedBox(height: Insets.md),
          Text(question, style: AppText.body),
          const SizedBox(height: Insets.lg),
          Row(
            children: [
              const SwIconBadge(icon: SwIcon.sparkle, circle: true, size: 32),
              const SizedBox(width: Insets.sm),
              Expanded(child: Text('Assistant', style: AppText.caption)),
            ],
          ),
          const SizedBox(height: Insets.md),
          if (asking)
            const SizedBox(
              height: 80,
              child: Center(
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            )
          else
            Text(answer ?? 'No answer.', style: AppText.body),
        ],
      ),
    );
  }
}

class _ItemPreview extends StatelessWidget {
  const _ItemPreview({required this.item});
  final _ItemFromJson item;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 110,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: double.infinity,
            height: 90,
            child: SwProductImage(image: item.image, radius: Radii.md),
          ),
          const SizedBox(height: Insets.sm),
          Text(
            item.name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppText.labelStrong.copyWith(fontSize: 11),
          ),
          Text(
            '${item.category} \u2022 ${item.color}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppText.caption.copyWith(fontSize: 10, color: AppColors.textTertiary),
          ),
          Text(
            '${item.timesWorn} wears',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppText.caption.copyWith(fontSize: 10, color: AppColors.primary),
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
      padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('\u2022 ', style: AppText.caption.copyWith(color: AppColors.primary)),
          Expanded(child: Text(text, style: AppText.caption)),
        ],
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.summary});
  final Map<String, dynamic> summary;

  @override
  Widget build(BuildContext context) {
    final total = summary['totalItems'] as int? ?? 0;
    final unworn = summary['unworn'] as int? ?? 0;
    return SwCard(
      padding: const EdgeInsets.all(Insets.lg),
      child: Row(
        children: [
          Expanded(
            child: _StatTile(value: '$total', label: 'Items owned'),
          ),
          Container(width: 1, height: 40, color: AppColors.border),
          Expanded(
            child: _StatTile(value: '$unworn', label: "Not worn yet"),
          ),
        ],
      ),
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({required this.value, required this.label});
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(value, style: AppText.statValue),
        const SizedBox(height: 2),
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: AppText.statLabel,
        ),
      ],
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
          const SwIconBadge(icon: SwIcon.shirt, size: 48, circle: true),
          const SizedBox(height: Insets.lg),
          Text('Your wardrobe is empty', style: AppText.h4),
          const SizedBox(height: Insets.sm),
          Text(
            'Add clothing first, then ask the assistant about what you own.',
            textAlign: TextAlign.center,
            style: AppText.body,
          ),
        ],
      ),
    );
  }
}
