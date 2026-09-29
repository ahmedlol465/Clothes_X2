import 'package:flutter/material.dart';

import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/models.dart';

/// Frame 22 - gap filling product recommendations.
///
/// Picks load from the backend (`GET /shop/recommended`, gap analysis §8.4)
/// and wishlist taps persist (`POST /shop/wishlist`).
class SmartShoppingScreen extends StatefulWidget {
  const SmartShoppingScreen({super.key});

  @override
  State<SmartShoppingScreen> createState() => _SmartShoppingScreenState();
}

class _SmartShoppingScreenState extends State<SmartShoppingScreen> {
  final _state = AppState.instance;
  final Set<int> _wishlisted = {};

  @override
  void initState() {
    super.initState();
    _state.loadShop();
  }

  Future<void> _toggle(int index) async {
    setState(() {
      if (!_wishlisted.remove(index)) _wishlisted.add(index);
    });
    if (_wishlisted.contains(index)) {
      final pick = _state.shopPicks[index];
      try {
        await _state.api.addToWishlist({
          'name': pick.name,
          'price': pick.price,
          'image': pick.image,
        });
      } catch (_) {
        // Offline: keep the local wishlist state.
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _state,
      builder: (context, _) => SwScreen(
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
                        Text('Smart Shopping', style: AppText.h1),
                        const SizedBox(height: 2),
                        Text(
                          'Based on your current wardrobe gaps',
                          style: AppText.caption,
                        ),
                      ],
                    ),
                  ),
                  const SwIconButton(icon: SwIconButtonKind.bag),
                ],
              ),
            ),
            const SizedBox(height: Insets.lg),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
              child: Column(
                children: [
                  for (var i = 0; i < _state.shopPicks.length; i++) ...[
                    _PickCard(
                      pick: _state.shopPicks[i],
                      wishlisted: _wishlisted.contains(i),
                      onToggle: () => _toggle(i),
                      onView: () => ScaffoldMessenger.of(context)
                        ..hideCurrentSnackBar()
                        ..showSnackBar(
                          SnackBar(
                            content: Text(
                              'Opening ${_state.shopPicks[i].name}',
                            ),
                          ),
                        ),
                    ),
                    const SizedBox(height: Insets.lg),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PickCard extends StatelessWidget {
  const _PickCard({
    required this.pick,
    required this.wishlisted,
    required this.onToggle,
    required this.onView,
  });

  final ShoppingPick pick;
  final bool wishlisted;
  final VoidCallback onToggle;
  final VoidCallback onView;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      padding: const EdgeInsets.all(Insets.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              SizedBox(
                width: 56,
                height: 56,
                child: SwProductImage(image: pick.image, radius: Radii.sm),
              ),
              const SizedBox(width: Insets.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(pick.name, style: AppText.cardTitle),
                    const SizedBox(height: 2),
                    Text(
                      pick.price,
                      style: AppText.bodyStrong.copyWith(
                        color: AppColors.primary,
                      ),
                    ),
                  ],
                ),
              ),
              GestureDetector(
                onTap: onToggle,
                child: Padding(
                  padding: const EdgeInsets.all(Insets.xs),
                  child: SwIconView(
                    wishlisted ? SwIcon.heartFill : SwIcon.heart,
                    size: 19,
                    color: AppColors.primary,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: Insets.lg),
          SwBanner(title: 'WHY RECOMMENDED?', message: pick.reason),
          const SizedBox(height: Insets.lg),
          FilledButton(
            onPressed: onView,
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(46),
              textStyle: AppText.button,
              shape: const RoundedRectangleBorder(
                borderRadius: Radii.pillRadius,
              ),
            ),
            child: const Text('View Product'),
          ),
        ],
      ),
    );
  }
}
