import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/models.dart';
import 'add_clothing_screen.dart';
import 'item_detail_screen.dart';

/// Frame 8 - searchable, filterable grid of every catalogued garment.
///
/// Data comes from the backend (`GET /wardrobe/items`) via [AppState] and
/// falls back to the bundled catalogue when the backend is unreachable.
class WardrobeScreen extends StatefulWidget {
  const WardrobeScreen({super.key});

  @override
  State<WardrobeScreen> createState() => _WardrobeScreenState();
}

class _WardrobeScreenState extends State<WardrobeScreen> {
  final _search = TextEditingController();
  final _state = AppState.instance;
  String _filter = 'All';
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _search.addListener(_onSearch);
    // Defer the first load until after the first frame: loadWardrobe()
    // notifies listeners synchronously and initState runs during the build
    // phase, which would make an already-mounted ListenableBuilder (on a
    // screen below this one, or a sibling tab) request a build mid-build
    // (setState/markNeedsBuild called during build).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _state.loadWardrobe();
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search
      ..removeListener(_onSearch)
      ..dispose();
    super.dispose();
  }

  void _onSearch() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), _reload);
  }

  void _reload() {
    _state.loadWardrobe(search: _search.text.trim(), category: _filter);
  }

  Future<void> _openAdd() async {
    await Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const AddClothingScreen()));
    if (mounted) _reload();
  }

  @override
  Widget build(BuildContext context) {
    return SwScreen(
      bottomBar: _AddClothesBar(onTap: _openAdd),
      child: ListenableBuilder(
        listenable: _state,
        builder: (context, _) {
          final items = _state.wardrobe;
          return Column(
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
                    Expanded(child: Text('My Wardrobe', style: AppText.h1)),
                    SwIconButton(
                      icon: SwIconButtonKind.filter,
                      onTap: () =>
                          _toast(context, 'Advanced filters coming soon.'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: Insets.lg),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
                child: _SearchField(controller: _search),
              ),
              const SizedBox(height: Insets.md),
              _FilterBar(
                filters: _state.wardrobeFilters,
                selected: _filter,
                onSelect: (v) {
                  setState(() => _filter = v);
                  _reload();
                },
              ),
              const SizedBox(height: Insets.lg),
              Expanded(
                child: _state.wardrobeLoading && items.isEmpty
                    ? const Center(
                        child: CircularProgressIndicator(
                          valueColor: AlwaysStoppedAnimation(
                            AppColors.primary,
                          ),
                        ),
                      )
                    : items.isEmpty
                        ? _EmptyWardrobe(query: _search.text)
                        : RefreshIndicator(
                            color: AppColors.primary,
                            onRefresh: () async => _reload(),
                            child: GridView.builder(
                              padding: const EdgeInsets.fromLTRB(
                                Insets.gutter,
                                0,
                                Insets.gutter,
                                96,
                              ),
                              physics: const BouncingScrollPhysics(),
                              gridDelegate:
                                  const SliverGridDelegateWithFixedCrossAxisCount(
                                crossAxisCount: 2,
                                mainAxisSpacing: Insets.lg,
                                crossAxisSpacing: Insets.md,
                                childAspectRatio: 0.72,
                              ),
                              itemCount: items.length,
                              itemBuilder: (context, i) => _GridCell(
                                item: items[i],
                                onOpen: _reload,
                              ),
                            ),
                          ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({required this.controller});

  final TextEditingController controller;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      style: AppText.field,
      cursorColor: AppColors.primary,
      decoration: InputDecoration(
        hintText: 'Search in your wardrobe...',
        hintStyle: AppText.fieldHint,
        prefixIcon: const Padding(
          padding: EdgeInsets.only(left: Insets.lg, right: Insets.md),
          child: SwIconView(
            SwIcon.search,
            size: 18,
            color: AppColors.textTertiary,
          ),
        ),
        prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: Insets.lg,
          vertical: Insets.lg,
        ),
      ),
    );
  }
}

class _FilterBar extends StatelessWidget {
  const _FilterBar({
    required this.filters,
    required this.selected,
    required this.onSelect,
  });

  final List<String> filters;
  final String selected;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 36,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
        physics: const BouncingScrollPhysics(),
        itemCount: filters.length,
        separatorBuilder: (_, _) => const SizedBox(width: Insets.sm),
        itemBuilder: (context, i) {
          final label = filters[i];
          return SwChip(
            label: label,
            selected: label == selected,
            onTap: () => onSelect(label),
          );
        },
      ),
    );
  }
}

class _GridCell extends StatelessWidget {
  const _GridCell({required this.item, required this.onOpen});

  final ClothingItem item;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => Navigator.of(context)
          .push(MaterialPageRoute(
              builder: (_) => ItemDetailScreen(item: item)))
          .then((_) => onOpen()),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: SizedBox(
              width: double.infinity,
              child: SwProductImage(image: item.image, radius: Radii.lg),
            ),
          ),
          const SizedBox(height: Insets.sm),
          Text(
            item.name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppText.labelStrong.copyWith(fontSize: 12),
          ),
          const SizedBox(height: 1),
          Text(
            item.meta,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppText.caption.copyWith(fontSize: 11),
          ),
        ],
      ),
    );
  }
}

class _EmptyWardrobe extends StatelessWidget {
  const _EmptyWardrobe({required this.query});

  final String query;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Insets.xxxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SwIconBadge(
              icon: SwIcon.shirt,
              size: 64,
              iconSize: 28,
              circle: true,
            ),
            const SizedBox(height: Insets.lg),
            Text(
              query.isEmpty ? 'Nothing here yet' : 'No matches',
              style: AppText.h4,
            ),
            const SizedBox(height: Insets.sm),
            Text(
              query.isEmpty
                  ? 'Add clothing to fill this category.'
                  : 'Try a different search or filter.',
              textAlign: TextAlign.center,
              style: AppText.body,
            ),
          ],
        ),
      ),
    );
  }
}

/// Persistent primary action pinned above the tab bar.
class _AddClothesBar extends StatelessWidget {
  const _AddClothesBar({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.background,
      padding: const EdgeInsets.fromLTRB(
        Insets.lg,
        Insets.md,
        Insets.lg,
        Insets.md,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          FilledButton.icon(
            onPressed: onTap,
            icon: const SwIconView(SwIcon.plus, size: 16, color: Colors.white),
            label: const Text('Add Clothes'),
            style: FilledButton.styleFrom(
              minimumSize: const Size(0, 48),
              padding: const EdgeInsets.symmetric(horizontal: Insets.xl),
              textStyle: AppText.button,
              shape: const RoundedRectangleBorder(
                borderRadius: Radii.pillRadius,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

void _toast(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}
