import 'package:flutter/material.dart';

import '../../app.dart';
import '../../core/app_copy.dart';
import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/controllers/outfits_controller.dart';
import '../../data/models.dart';

/// Frame 17 - what has already been worn, with thumbs up / down feedback.
///
/// The list is the user's saved outfits from the database; there is no bundled
/// history.
class OutfitHistoryScreen extends StatefulWidget {
  const OutfitHistoryScreen({
    super.key,
    this.embedded = false,
    this.outfitsController,
  });

  /// True when hosted inside the Outfits tab, which already draws the header.
  final bool embedded;
  final OutfitsController? outfitsController;

  @override
  State<OutfitHistoryScreen> createState() => _OutfitHistoryScreenState();
}

class _OutfitHistoryScreenState extends State<OutfitHistoryScreen> {
  late final OutfitsController _controller;

  @override
  void initState() {
    super.initState();
    _controller = widget.outfitsController ?? AppState.instance.outfitsController;
    _controller.loadSaved();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _controller,
      builder: (context, _) {
        final outfits = _controller.saved;
        final body = ListView(
          padding: EdgeInsets.fromLTRB(
            Insets.gutter,
            widget.embedded ? Insets.lg : Insets.md,
            Insets.gutter,
            Insets.xxl,
          ),
          physics: const BouncingScrollPhysics(),
          children: [
            if (outfits.isEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: Insets.lg),
                child: Text(AppCopy.emptyOutfits, style: AppText.caption),
              ),
            for (final outfit in outfits) ...[
              _HistoryRow(
                when: _whenLabel(outfit.createdAt),
                title: outfit.name,
                occasion: outfit.occasion,
                image: outfit.image,
                onOpen: () => Navigator.of(context).pushNamed(
                  Routes.perfectMatch,
                  arguments: outfit,
                ),
                onLike: () => _sendFeedback(outfit, 5),
                onDislike: () => _sendFeedback(outfit, 1),
              ),
              const SizedBox(height: Insets.md),
            ],
            const SwBanner(
              icon: SwIcon.circleInfo,
              message:
                  'Your feedback helps AI learn your personal style and wardrobe '
                  'preferences over time.',
            ),
          ],
        );

        if (widget.embedded) return body;

        return SwScreen(
          child: Column(
            children: [
              const SwAppBar(
                title: 'Outfit History',
                subtitle: 'Your recently styled and worn looks',
              ),
              Expanded(child: body),
            ],
          ),
        );
      },
    );
  }

  Future<void> _sendFeedback(Outfit outfit, int rating) async {
    final ok = await _controller.feedback(outfit, rating: rating);
    if (!mounted) return;
    _toast(
      context,
      ok
          ? (rating >= 3
              ? 'Thanks for the feedback!'
              : 'Noted - we will tune future picks.')
          : 'Could not save feedback. Check the backend and try again.',
    );
  }

  static String _whenLabel(DateTime? createdAt) {
    if (createdAt == null) return 'SAVED';
    final local = createdAt.toLocal();
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(local.year, local.month, local.day);
    final diff = today.difference(day).inDays;
    if (diff <= 0) return 'TODAY';
    if (diff == 1) return 'YESTERDAY';
    const months = [
      'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
      'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
    ];
    return '${months[local.month - 1]} ${local.day}';
  }
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({
    required this.when,
    required this.title,
    required this.occasion,
    required this.image,
    required this.onOpen,
    required this.onLike,
    required this.onDislike,
  });

  final String when;
  final String title;
  final String occasion;
  final String image;
  final VoidCallback onOpen;
  final VoidCallback onLike;
  final VoidCallback onDislike;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      onTap: onOpen,
      padding: const EdgeInsets.all(Insets.md),
      child: Row(
        children: [
          SizedBox(
            width: 52,
            height: 52,
            child: SwProductImage(image: image, radius: Radii.sm),
          ),
          const SizedBox(width: Insets.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  when,
                  style: AppText.overline.copyWith(
                    fontSize: 9,
                    color: AppColors.primary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.cardTitle.copyWith(fontSize: 14),
                ),
                Text(
                  occasion,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.caption,
                ),
              ],
            ),
          ),
          _FeedbackButton(icon: SwIcon.thumbUp, onTap: onLike),
          const SizedBox(width: Insets.sm),
          _FeedbackButton(icon: SwIcon.thumbDown, onTap: onDislike),
        ],
      ),
    );
  }
}

class _FeedbackButton extends StatelessWidget {
  const _FeedbackButton({required this.icon, required this.onTap});

  final SwIcon icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 32,
        height: 32,
        alignment: Alignment.center,
        decoration: const BoxDecoration(
          color: AppColors.background,
          shape: BoxShape.circle,
        ),
        child: SwIconView(
          icon,
          size: 14,
          color: AppColors.textSecondary,
          strokeWidth: 2,
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
