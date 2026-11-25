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
          if (pick.id != null && pick.id!.isNotEmpty)
            'shoppingItemId': pick.id,
          'name': pick.name,
          'price': double.tryParse(
                pick.price.replaceAll(RegExp(r'[^0-9.]'), ''),
              ) ??
              0,
          'imageUrl': pick.image,
        });
      } catch (_) {
        // Offline: keep the local wishlist state.
      }
    }
  }

  /// Saved-for-later list: everything hearted on this screen, removable.
  void _openWishlist() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) =>
          _WishlistSheet(shopController: widget._shopController),
    );
  }

  /// Product details sheet with sale info, sizes and the Before You Buy
  /// wardrobe-compatibility check.
  void _openProduct(ShoppingPick pick) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) => _ProductDetailSheet(
        pick: pick,
        shopController: widget._shopController,
      ),
    );
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
                  SwIconButton(
                    icon: SwIconButtonKind.bag,
                    onTap: _openWishlist,
                  ),
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
                      onView: () => _openProduct(
                        widget._shopController.picks[i],
                      ),
                    ),
                    const SizedBox(height: Insets.lg),
                  ],
                ],
              ),
            ),
            const SizedBox(height: Insets.xl),
            _CatalogSection(
              shopController: widget._shopController,
              onOpenProduct: _openProduct,
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

/// Product detail sheet: gallery image, price (with sale strike-through),
/// store metadata, sizes, the recommendation reason, and a Before You Buy
/// check against the user's own wardrobe.
class _ProductDetailSheet extends StatefulWidget {
  const _ProductDetailSheet({required this.pick, required this.shopController});

  final ShoppingPick pick;
  final ShopController shopController;

  @override
  State<_ProductDetailSheet> createState() => _ProductDetailSheetState();
}

class _ProductDetailSheetState extends State<_ProductDetailSheet> {
  bool _checking = false;
  Map<String, dynamic>? _verdict;

  Future<void> _beforeYouBuy() async {
    setState(() {
      _checking = true;
      _verdict = null;
    });
    try {
      final res = await widget.shopController.api.beforeYouBuy({
        'productName': widget.pick.name,
        'color': widget.pick.color ?? 'White',
        'category': widget.pick.category ?? 'Tops',
      });
      final data = res['data'] is Map
          ? Map<String, dynamic>.from(res['data'] as Map)
          : res;
      setState(() => _verdict = data);
    } catch (_) {
      setState(() => _verdict = {'verdict': 'Check unavailable right now'});
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pick = widget.pick;
    final verdict = _verdict;
    final bestMatch = verdict?['bestMatch'];
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(Insets.gutter),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Center(
              child: SizedBox(
                width: 140,
                height: 140,
                child: SwProductImage(image: pick.image, radius: Radii.md),
              ),
            ),
            const SizedBox(height: Insets.lg),
            Text(pick.name, style: AppText.h3),
            const SizedBox(height: Insets.sm),
            Row(
              children: [
                Text(
                  pick.price,
                  style: AppText.bodyStrong.copyWith(
                    color: AppColors.primary,
                    fontSize: 16,
                  ),
                ),
                if (pick.originalPrice != null) ...[
                  const SizedBox(width: Insets.sm),
                  Text(
                    pick.originalPrice!,
                    style: AppText.caption.copyWith(
                      decoration: TextDecoration.lineThrough,
                    ),
                  ),
                  const SizedBox(width: Insets.sm),
                  Text(
                    'SALE',
                    style: AppText.overline.copyWith(
                      color: AppColors.danger,
                      fontSize: 10,
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: Insets.sm),
            Text(
              [
                if (pick.store != null) pick.store!,
                if (pick.color != null) pick.color!,
                if (pick.category != null) pick.category!,
                if (!pick.inStock) 'Out of stock',
              ].join(' • '),
              style: AppText.caption,
            ),
            if (pick.sizes.isNotEmpty) ...[
              const SizedBox(height: Insets.md),
              Wrap(
                spacing: Insets.sm,
                runSpacing: Insets.sm,
                children: [
                  for (final size in pick.sizes)
                    SwChip(
                      label: size,
                      selected: false,
                      tone: SwChipTone.tinted,
                      dense: true,
                    ),
                ],
              ),
            ],
            if (pick.reason.isNotEmpty) ...[
              const SizedBox(height: Insets.lg),
              SwBanner(title: 'WHY RECOMMENDED?', message: pick.reason),
            ],
            const SizedBox(height: Insets.lg),
            if (verdict != null) ...[
              SwBanner(
                title: 'BEFORE YOU BUY',
                message:
                    '${verdict['verdict'] ?? ''}'
                    '${bestMatch is Map && bestMatch['with'] != null ? ' — best match: ${bestMatch['with']} (${bestMatch['match']}%)' : ''}',
              ),
              const SizedBox(height: Insets.lg),
            ],
            FilledButton(
              onPressed: _checking ? null : _beforeYouBuy,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(46),
                textStyle: AppText.button,
                shape: const RoundedRectangleBorder(
                  borderRadius: Radii.pillRadius,
                ),
              ),
              child: Text(
                _checking ? 'Checking your wardrobe…' : 'Check with my wardrobe',
              ),
            ),
            const SizedBox(height: Insets.md),
          ],
        ),
      ),
    );
  }
}

/// The user's saved products (`GET /shop/wishlist`), each removable
/// (`DELETE /shop/wishlist/:id`).
class _WishlistSheet extends StatefulWidget {
  const _WishlistSheet({required this.shopController});

  final ShopController shopController;

  @override
  State<_WishlistSheet> createState() => _WishlistSheetState();
}

class _WishlistSheetState extends State<_WishlistSheet> {
  List<dynamic>? _items;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final items = await widget.shopController.api.wishlist();
      if (mounted) setState(() => _items = items);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load your wishlist.');
    }
  }

  Future<void> _remove(String id) async {
    try {
      await widget.shopController.api.removeFromWishlist(id);
    } catch (_) {
      // Keep the UI honest: only drop the row when the server accepted it.
      return;
    }
    if (mounted) {
      setState(() {
        _items = [
          for (final i in _items ?? const []) if ('${(i as Map)['id']}' != id) i,
        ];
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(Insets.gutter),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Wishlist', style: AppText.h3),
            const SizedBox(height: Insets.lg),
            if (_error != null)
              Text(_error!, style: AppText.caption)
            else if (items == null)
              const Center(
                child: CircularProgressIndicator(
                  valueColor: AlwaysStoppedAnimation(AppColors.primary),
                ),
              )
            else if (items.isEmpty)
              Text(
                'Nothing saved yet. Tap the heart on any product.',
                style: AppText.caption,
              )
            else
              for (final item in items)
                Padding(
                  padding: const EdgeInsets.only(bottom: Insets.md),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 48,
                        height: 48,
                        child: SwProductImage(
                          image:
                              '${(item as Map)['imageUrl'] ?? Img.teeWhite}',
                          radius: Radii.sm,
                        ),
                      ),
                      const SizedBox(width: Insets.md),
                      Expanded(
                        child: Text(
                          '${item['name'] ?? ''}',
                          style: AppText.bodyStrong,
                        ),
                      ),
                      GestureDetector(
                        onTap: () => _remove('${item['id']}'),
                        child: const Padding(
                          padding: EdgeInsets.all(Insets.xs),
                          child: SwIconView(
                            SwIcon.close,
                            size: 16,
                            color: AppColors.textTertiary,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
          ],
        ),
      ),
    );
  }
}

/// The full store catalog below the personalized picks: category filter
/// chips and a 2-column grid of every in-stock product. Tapping a tile
/// opens the same detail sheet as a pick.
class _CatalogSection extends StatefulWidget {
  const _CatalogSection({
    required this.shopController,
    required this.onOpenProduct,
  });

  final ShopController shopController;
  final void Function(ShoppingPick) onOpenProduct;

  @override
  State<_CatalogSection> createState() => _CatalogSectionState();
}

class _CatalogSectionState extends State<_CatalogSection> {
  static const _categories = [
    'All', 'Tops', 'Bottoms', 'Shoes', 'Outerwear', 'Accessories',
  ];

  String _category = 'All';
  List<ShoppingPick>? _products;

  @override
  void initState() {
    super.initState();
    _load();
  }

  ShoppingPick _map(Map j) => ShoppingPick(
        id: '${j['id'] ?? ''}',
        name: '${j['name'] ?? ''}',
        price: _formatPrice(j['price'], j['currency']),
        image: '${j['imageUrl'] ?? Img.teeWhite}',
        reason: '${j['reason'] ?? ''}',
        store: j['store'] == null ? null : '${j['store']}',
        color: j['color'] == null ? null : '${j['color']}',
        category: j['category'] == null ? null : '${j['category']}',
        sizes: [for (final v in (j['sizes'] as List? ?? const [])) '$v'],
        originalPrice: j['originalPrice'] == null
            ? null
            : _formatPrice(j['originalPrice'], j['currency']),
        inStock: j['inStock'] != false,
      );

  static String _formatPrice(Object? raw, Object? currency) {
    final cur = '${currency ?? ''}'.trim();
    if (raw is num) {
      final grouped = raw
          .toStringAsFixed(0)
          .replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+\b)'), (m) => '${m[1]},');
      return cur.isEmpty ? grouped : '$grouped $cur';
    }
    return '${raw ?? ''}';
  }

  Future<void> _load() async {
    try {
      final rows = await widget.shopController.api.shopProducts(
        category: _category == 'All' ? null : _category,
      );
      if (mounted) {
        setState(() => _products = [for (final r in rows) _map(r as Map)]);
      }
    } catch (_) {
      if (mounted) setState(() => _products = const []);
    }
  }

  @override
  Widget build(BuildContext context) {
    final products = _products;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('CATALOG', style: AppText.overline),
          const SizedBox(height: Insets.md),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final c in _categories) ...[
                  SwChip(
                    label: c,
                    selected: _category == c,
                    tone: SwChipTone.tinted,
                    dense: true,
                    onTap: () {
                      setState(() {
                        _category = c;
                        _products = null;
                      });
                      _load();
                    },
                  ),
                  const SizedBox(width: Insets.sm),
                ],
              ],
            ),
          ),
          const SizedBox(height: Insets.lg),
          if (products == null)
            const Center(
              child: CircularProgressIndicator(
                valueColor: AlwaysStoppedAnimation(AppColors.primary),
              ),
            )
          else if (products.isEmpty)
            Text('No products here yet.', style: AppText.caption)
          else
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: Insets.lg,
              crossAxisSpacing: Insets.md,
              childAspectRatio: 0.78,
              children: [
                for (final p in products)
                  GestureDetector(
                    onTap: () => widget.onOpenProduct(p),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: SwProductImage(
                            image: p.image,
                            radius: Radii.md,
                          ),
                        ),
                        const SizedBox(height: Insets.sm),
                        Text(
                          p.name,
                          style: AppText.bodyStrong,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        Text(
                          p.price,
                          style: AppText.caption.copyWith(
                            color: AppColors.primary,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}
