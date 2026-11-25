import 'package:flutter/material.dart';

import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/assets.dart';
import '../../data/controllers/shop_controller.dart';
import '../../data/models.dart';

/// Frame 22 - gap filling product recommendations.
///
/// Picks load from the backend (`GET /shop/recommended`, gap analysis §8.4)
/// and wishlist taps persist (`POST /shop/wishlist`).
class SmartShoppingScreen extends StatefulWidget {
  const SmartShoppingScreen._(this._shopController);

  factory SmartShoppingScreen({Key? key, ShopController? shopController}) {
    return SmartShoppingScreen._(
      shopController ?? AppState.instance.shopController,
    );
  }

  final ShopController _shopController;

  @override
  State<SmartShoppingScreen> createState() => _SmartShoppingScreenState();
}

class _SmartShoppingScreenState extends State<SmartShoppingScreen> {
  final Set<int> _wishlisted = {};

  @override
  void initState() {
    super.initState();
    widget._shopController.load();
  }

  Future<void> _toggle(int index) async {
    setState(() {
      if (!_wishlisted.remove(index)) _wishlisted.add(index);
    });
    if (_wishlisted.contains(index)) {
      final pick = widget._shopController.picks[index];
      try {
        await widget._shopController.api.addToWishlist({
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
      listenable: widget._shopController,
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
              child: _BudgetBuilderCard(shopController: widget._shopController),
            ),
            const SizedBox(height: Insets.xl),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
              child: Column(
                children: [
                  for (var i = 0; i < widget._shopController.picks.length; i++) ...[
                    _PickCard(
                      pick: widget._shopController.picks[i],
                      wishlisted: _wishlisted.contains(i),
                      onToggle: () => _toggle(i),
                      onView: () => ScaffoldMessenger.of(context)
                        ..hideCurrentSnackBar()
                        ..showSnackBar(
                          SnackBar(
                            content: Text(
                              'Opening ${widget._shopController.picks[i].name}',
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

/// "Set a budget, get an outfit" card. The server picks the best-value
/// in-stock set that fits the budget and scores it with the stylist's
/// compatibility engine (`POST /shop/outfit-builder`).
class _BudgetBuilderCard extends StatefulWidget {
  const _BudgetBuilderCard({required this.shopController});

  final ShopController shopController;

  @override
  State<_BudgetBuilderCard> createState() => _BudgetBuilderCardState();
}

class _BudgetBuilderCardState extends State<_BudgetBuilderCard> {
  final _budget = TextEditingController(text: '6000');
  bool _loading = false;
  Map<String, dynamic>? _result;
  String? _error;

  @override
  void dispose() {
    _budget.dispose();
    super.dispose();
  }

  Future<void> _build() async {
    final budget = double.tryParse(_budget.text.trim()) ?? 0;
    if (budget <= 0) {
      setState(() => _error = 'Enter a budget first.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
      _result = null;
    });
    try {
      final res = await widget.shopController.api
          .buildOutfitWithinBudget(budget);
      final data = res['data'] is Map
          ? Map<String, dynamic>.from(res['data'] as Map)
          : res;
      setState(() => _result = data);
    } catch (_) {
      setState(() => _error = 'Could not build an outfit right now.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    final items = (result?['items'] as List?) ?? const [];
    final total = result?['total'];
    final currency = '${result?['currency'] ?? 'EGP'}';
    final match = result?['match'];
    final withinBudget = result?['withinBudget'] == true;
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
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(Radii.sm),
                  child: Image.asset(Img.avatarFittingRoom, fit: BoxFit.cover),
                ),
              ),
              const SizedBox(width: Insets.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Outfit Budget Builder', style: AppText.cardTitle),
                    const SizedBox(height: 2),
                    Text(
                      'Set a budget, get a full outfit',
                      style: AppText.caption,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: Insets.lg),
          SwField(
            label: 'Budget (EGP)',
            controller: _budget,
            hint: '6000',
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: Insets.md),
          FilledButton(
            onPressed: _loading ? null : _build,
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(46),
              textStyle: AppText.button,
              shape: const RoundedRectangleBorder(
                borderRadius: Radii.pillRadius,
              ),
            ),
            child: Text(_loading ? 'Building…' : 'Build my outfit'),
          ),
          if (_error != null) ...[
            const SizedBox(height: Insets.md),
            Text(
              _error!,
              style: AppText.caption.copyWith(color: AppColors.danger),
            ),
          ],
          if (result != null) ...[
            const SizedBox(height: Insets.lg),
            if (items.isEmpty)
              Text(
                'No full outfit fits that budget yet. Try a higher budget.',
                style: AppText.caption,
              )
            else ...[
              for (final item in items)
                Padding(
                  padding: const EdgeInsets.only(bottom: Insets.sm),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${(item as Map)['name'] ?? ''}',
                          style: AppText.body,
                        ),
                      ),
                      Text(
                        '${item['price']} $currency',
                        style: AppText.bodyStrong,
                      ),
                    ],
                  ),
                ),
              const Divider(),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      withinBudget ? 'Total' : 'Best partial set',
                      style: AppText.bodyStrong,
                    ),
                  ),
                  Text('$total $currency', style: AppText.bodyStrong),
                ],
              ),
              if (match != null) ...[
                const SizedBox(height: 2),
                Text(
                  'Stylist match: $match%',
                  style: AppText.caption.copyWith(color: AppColors.primary),
                ),
              ],
            ],
          ],
        ],
      ),
    );
  }
}
