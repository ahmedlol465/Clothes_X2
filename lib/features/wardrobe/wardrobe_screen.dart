import 'dart:async';

import 'package:flutter/material.dart';

import '../../app.dart';
import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/backend_status.dart';
import '../../data/controllers/wardrobe_controller.dart';
import '../../data/models.dart';

/// Frame 8 - searchable, filterable grid of every catalogued garment.
///
/// Data comes from the backend (`GET /wardrobe/items`) via [WardrobeController]
/// and falls back to the bundled catalogue when the backend is unreachable.
class WardrobeScreen extends StatefulWidget {
  const WardrobeScreen({
    super.key,
    this.wardrobeController,
    this.backendStatus,
  });

  final WardrobeController? wardrobeController;
  final BackendStatus? backendStatus;

  @override
  State<WardrobeScreen> createState() => _WardrobeScreenState();
}

class _WardrobeScreenState extends State<WardrobeScreen> {
  final _search = TextEditingController();
  String _filter = 'All';

  // Advanced filters (client side, on top of the category/search reload).
  final Set<String> _colorFilters = {};
  final Set<String> _seasonFilters = {};
  final Set<String> _formalityFilters = {};
  String _sort = 'newest'; // newest | mostWorn | az
  Timer? _debounce;
  late final WardrobeController _wardrobeController;
  late final BackendStatus _backendStatus;

  @override
  void initState() {
    super.initState();
    _search.addListener(_onSearch);
    _wardrobeController = widget.wardrobeController ?? AppState.instance.wardrobeController;
    _backendStatus = widget.backendStatus ?? AppState.instance.backendStatus;
    // Defer the first load until after the first frame: loadWardrobe()
    // notifies listeners synchronously and initState runs during the build
    // phase, which would make an already-mounted ListenableBuilder (on a
    // screen below this one, or a sibling tab) request a build mid-build
    // (setState/markNeedsBuild called during build).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _wardrobeController.load();
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
    _wardrobeController.load(search: _search.text.trim(), category: _filter);
  }

  /// Applies the advanced filter state to the loaded items.
  List<ClothingItem> _applyAdvancedFilters(List<ClothingItem> items) {
    var out = items.where((item) {
      if (_colorFilters.isNotEmpty &&
          !_colorFilters.any(
            (c) => item.color.toLowerCase().contains(c.toLowerCase()),
          )) {
        return false;
      }
      if (_seasonFilters.isNotEmpty &&
          !_seasonFilters.any(
            (v) => item.season.toLowerCase() == v.toLowerCase(),
          )) {
        return false;
      }
      if (_formalityFilters.isNotEmpty &&
          !_formalityFilters.any(
            (v) => item.formality.toLowerCase() == v.toLowerCase(),
          )) {
        return false;
      }
      return true;
    }).toList();
    switch (_sort) {
      case 'mostWorn':
        out.sort((a, b) => b.timesWorn.compareTo(a.timesWorn));
      case 'az':
        out.sort(
          (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
        );
    }
    return out;
  }

  bool get _advancedFiltersActive =>
      _colorFilters.isNotEmpty ||
      _seasonFilters.isNotEmpty ||
      _formalityFilters.isNotEmpty;

  void _openFilterSheet(List<ClothingItem> items) {
    final colors = <String>{
      for (final i in items)
        if (i.color.trim().isNotEmpty) i.color.trim(),
    }.toList()
      ..sort();
    final seasons = <String>{
      for (final i in items)
        if (i.season.trim().isNotEmpty) i.season.trim(),
    }.toList()
      ..sort();
    final formalities = <String>{
      for (final i in items)
        if (i.formality.trim().isNotEmpty) i.formality.trim(),
    }.toList()
      ..sort();

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setSheet) {
            Widget chips(
              String title,
              List<String> options,
              Set<String> selected,
            ) =>
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: AppText.label),
                    const SizedBox(height: Insets.sm),
                    Wrap(
                      spacing: Insets.sm,
                      runSpacing: Insets.sm,
                      children: [
                        for (final o in options)
                          SwChip(
                            label: o,
                            selected: selected.contains(o),
                            tone: SwChipTone.tinted,
                            dense: true,
                            onTap: () => setSheet(() {
                              if (!selected.remove(o)) selected.add(o);
                            }),
                          ),
                      ],
                    ),
                  ],
                );
            return SafeArea(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(Insets.gutter),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        Expanded(child: Text('Filters', style: AppText.h4)),
                        TextButton(
                          onPressed: () => setSheet(() {
                            _colorFilters.clear();
                            _seasonFilters.clear();
                            _formalityFilters.clear();
                            _sort = 'newest';
                          }),
                          child: const Text('Clear all'),
                        ),
                      ],
                    ),
                    if (colors.isNotEmpty) ...[
                      chips('Color', colors, _colorFilters),
                      const SizedBox(height: Insets.lg),
                    ],
                    if (seasons.isNotEmpty) ...[
                      chips('Season', seasons, _seasonFilters),
                      const SizedBox(height: Insets.lg),
                    ],
                    if (formalities.isNotEmpty) ...[
                      chips('Formality', formalities, _formalityFilters),
                      const SizedBox(height: Insets.lg),
                    ],
                    Text('Sort by', style: AppText.label),
                    const SizedBox(height: Insets.sm),
                    Wrap(
                      spacing: Insets.sm,
                      runSpacing: Insets.sm,
                      children: [
                        for (final (value, label) in const [
                          ('newest', 'Newest'),
                          ('mostWorn', 'Most worn'),
                          ('az', 'A-Z'),
                        ])
                          SwChip(
                            label: label,
                            selected: _sort == value,
                            tone: SwChipTone.tinted,
                            dense: true,
                            onTap: () => setSheet(() => _sort = value),
                          ),
                      ],
                    ),
                    const SizedBox(height: Insets.xl),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: () {
                          Navigator.of(sheetContext).pop();
                          setState(() {});
                        },
                        style: FilledButton.styleFrom(
                          backgroundColor: AppColors.primary,
                          foregroundColor: Colors.white,
                        ),
                        child: const Text('Apply'),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    ).then((_) => setState(() {}));
  }

  Future<void> _openAdd() async {
    await Navigator.of(context).pushNamed(Routes.addClothing);
    if (mounted) _reload();
  }

  @override
  Widget build(BuildContext context) {
    return SwScreen(
      bottomBar: _AddClothesBar(onTap: _openAdd),
      child: ListenableBuilder(
        listenable: Listenable.merge([
          _wardrobeController,
          _backendStatus,
        ]),
        builder: (context, _) {
          final rawItems = _wardrobeController.items;
          final items = _applyAdvancedFilters(rawItems);
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
                      onTap: () => _openFilterSheet(rawItems),
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
                filters: _wardrobeController.filters,
                selected: _filter,
                onSelect: (v) {
                  setState(() => _filter = v);
                  _reload();
                },
              ),
              const SizedBox(height: Insets.lg),
              Expanded(
                child: _wardrobeController.loading && items.isEmpty
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
          .pushNamed(Routes.itemDetail, arguments: item)
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
