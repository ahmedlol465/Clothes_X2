import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api/api_client.dart';
import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';

/// Frame 9 — real Add Clothes flow (spec §4.4):
/// Take Photo / Gallery / Upload Multiple all pick real device photos,
/// each photo is uploaded (`POST /wardrobe/upload`) and analyzed on its
/// actual pixels (`POST /ai/analyze-clothing`, Gemini vision when a key is
/// configured, heuristics otherwise). Tags are editable before saving, and
/// saving persists the garment with its real photo URL (`POST
/// /wardrobe/items`). No demo data anywhere on this page.
class AddClothingScreen extends StatefulWidget {
  const AddClothingScreen({super.key});

  @override
  State<AddClothingScreen> createState() => _AddClothingScreenState();
}

enum _Phase { pending, staging, ready, saving, done, error }

class _Staged {
  _Staged({
    required this.filename,
    required this.bytes,
    required this.mimeType,
  });

  final String filename;
  final Uint8List bytes;
  final String mimeType;
  _Phase phase = _Phase.pending;
  String? url;
  Map<String, dynamic> analysis = {};
  String source = 'heuristic';
  String? error;
}

const _tagFields = <String, String>{
  'CATEGORY': 'category',
  'COLOR': 'color',
  'STYLE': 'style',
  'PATTERN': 'pattern',
  'MATERIAL': 'material',
  'SEASON': 'season',
  'FORMALITY': 'formality',
};

String _tagValue(Map<String, dynamic> analysis, String label) {
  const defaults = {
    'CATEGORY': 'Tops',
    'COLOR': 'White',
    'STYLE': 'Casual',
    'PATTERN': 'Plain',
    'MATERIAL': 'Cotton',
    'SEASON': 'All Season',
    'FORMALITY': 'Casual',
  };
  final v = analysis[_tagFields[label]];
  if (v == null || '$v'.isEmpty) return defaults[label]!;
  return '$v';
}

class _AddClothingScreenState extends State<AddClothingScreen> {
  final ImagePicker _picker = ImagePicker();
  final List<_Staged> _photos = [];
  bool _saving = false;
  String? _pageError;

  bool get _busy => _photos.any((p) =>
      p.phase == _Phase.staging ||
      p.phase == _Phase.pending ||
      p.phase == _Phase.saving);

  List<_Staged> get _ready =>
      _photos.where((p) => p.phase == _Phase.ready).toList();

  // ---------------------------------------------------------- picking
  Future<void> _takePhoto() async {
    try {
      final x = await _picker.pickImage(
        source: ImageSource.camera,
        maxWidth: 1600,
        imageQuality: 85,
      );
      if (x == null) return;
      await _addPicked([x]);
    } catch (e) {
      _fail('Camera unavailable: ${_shortError(e)}');
    }
  }

  Future<void> _fromGallery() async {
    try {
      final x = await _picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1600,
        imageQuality: 85,
      );
      if (x == null) return;
      await _addPicked([x]);
    } catch (e) {
      _fail('Gallery unavailable: ${_shortError(e)}');
    }
  }

  Future<void> _uploadMultiple() async {
    try {
      final xs = await _picker.pickMultiImage(
        maxWidth: 1600,
        imageQuality: 85,
      );
      if (xs.isEmpty) return;
      await _addPicked(xs.take(10).toList());
    } catch (e) {
      _fail('Picker unavailable: ${_shortError(e)}');
    }
  }

  Future<void> _addPicked(List<XFile> files) async {
    setState(() {
      _pageError = null;
      for (final f in files) {
        _photos.add(_Staged(
          filename: f.name.isNotEmpty ? f.name : 'photo.jpg',
          bytes: Uint8List(0),
          mimeType: _guessMime(f.name),
        ));
      }
    });
    // Read bytes + stage sequentially so progress is easy to follow.
    for (var i = _photos.length - files.length; i < _photos.length; i++) {
      final bytes = await files[i - (_photos.length - files.length)]
          .readAsBytes()
          .catchError((Object e) => Uint8List(0));
      if (bytes.isEmpty) {
        setState(() {
          _photos[i].phase = _Phase.error;
          _photos[i].error = 'Could not read this file.';
        });
        continue;
      }
      _photos[i] = _Staged(
        filename: _photos[i].filename,
        bytes: bytes,
        mimeType: _photos[i].mimeType,
      );
      await _stage(i);
    }
  }

  String _guessMime(String name) {
    final n = name.toLowerCase();
    if (n.endsWith('.png')) return 'image/png';
    if (n.endsWith('.webp')) return 'image/webp';
    if (n.endsWith('.heic') || n.endsWith('.heif')) return 'image/heic';
    return 'image/jpeg';
  }

  Future<void> _stage(int index) async {
    final photo = _photos[index];
    setState(() {
      photo.phase = _Phase.staging;
      photo.error = null;
    });
    try {
      final staged = await AppState.instance.stagePhoto(
        filename: photo.filename,
        bytes: photo.bytes,
        mimeType: photo.mimeType,
      );
      if (!mounted) return;
      setState(() {
        photo.phase = _Phase.ready;
        photo.url = staged.url;
        photo.analysis = staged.analysis;
        photo.source = staged.source;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        photo.phase = _Phase.error;
        photo.error = e.message;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        photo.phase = _Phase.error;
        photo.error = _shortError(e);
      });
    }
  }

  void _fail(String message) {
    if (!mounted) return;
    setState(() => _pageError = message);
  }

  String _shortError(Object e) =>
      e is ApiException ? e.message : 'unexpected error';

  void _removeAt(int index) {
    setState(() => _photos.removeAt(index));
  }

  void _retry(int index) => _stage(index);

  // -------------------------------------------------------------- save
  Future<void> _save() async {
    final ready = _ready;
    if (ready.isEmpty || _saving) return;
    setState(() {
      _saving = true;
      _pageError = null;
      for (final p in ready) {
        p.phase = _Phase.saving;
      }
    });
    var saved = 0;
    String? firstError;
    for (final p in ready) {
      try {
        await AppState.instance.addItem({
          'name':
              '${p.analysis['suggestedName'] ?? p.filename.split('.').first}',
          'image': p.url,
          'category': _tagValue(p.analysis, 'CATEGORY'),
          'color': _tagValue(p.analysis, 'COLOR'),
          'style': _tagValue(p.analysis, 'STYLE'),
          'pattern': _tagValue(p.analysis, 'PATTERN'),
          'material': _tagValue(p.analysis, 'MATERIAL'),
          'season': _tagValue(p.analysis, 'SEASON'),
          'formality': _tagValue(p.analysis, 'FORMALITY'),
          'analysisSource': p.source,
        });
        p.phase = _Phase.done;
        saved++;
      } on ApiException catch (e) {
        p.phase = _Phase.error;
        p.error = e.message;
        firstError ??= e.message;
      }
    }
    if (!mounted) return;
    setState(() => _saving = false);
    if (saved == 0) {
      _fail('Nothing saved: ${firstError ?? 'unknown error'}');
      return;
    }
    _photos.removeWhere((p) => p.phase == _Phase.done);
    Navigator.of(context).pop();
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            saved == 1
                ? 'Saved to your wardrobe.'
                : 'Saved $saved photos to your wardrobe.',
          ),
        ),
      );
  }

  // --------------------------------------------------------------- build
  @override
  Widget build(BuildContext context) {
    final ready = _ready;
    return SwScreen(
      scroll: true,
      padding: const EdgeInsets.only(bottom: Insets.xxl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SwAppBar(title: 'Add New Clothing'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
            child: Column(
              children: [
                _SourceTile(
                  icon: SwIcon.camera,
                  title: 'Take Photo',
                  subtitle: 'Instantly capture and auto-tag a piece',
                  onTap: _busy || _saving ? null : _takePhoto,
                ),
                const SizedBox(height: Insets.md),
                _SourceTile(
                  icon: SwIcon.image,
                  title: 'Choose from Gallery',
                  subtitle: 'Select existing clothing images',
                  onTap: _busy || _saving ? null : _fromGallery,
                ),
                const SizedBox(height: Insets.md),
                _SourceTile(
                  icon: SwIcon.upload,
                  title: 'Upload Multiple',
                  subtitle: 'Bulk import your wardrobe catalog',
                  onTap: _busy || _saving ? null : _uploadMultiple,
                ),
                const SizedBox(height: Insets.xl),
                if (_pageError != null) _ErrorBanner(message: _pageError!),
                if (_photos.isNotEmpty) ...[
                  _PreviewGrid(
                    photos: _photos,
                    onRemove: _removeAt,
                    onRetry: _retry,
                  ),
                  const SizedBox(height: Insets.xl),
                ],
                const Divider(height: 1),
                const SizedBox(height: Insets.lg),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Insets.gutter),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _StatusLine(photos: _photos),
                const SizedBox(height: Insets.lg),
                // Single analyzed photo → real editable tags.
                if (ready.length == 1)
                  _TagGrid(
                    photo: ready.first,
                    onChanged: (label, value) => setState(() {
                      ready.first.analysis[_tagFields[label]!] = value;
                    }),
                  ),
                if (ready.length > 1)
                  Text(
                    '${ready.length} photos analyzed — saving keeps every detected tag. Edit details later from each item.',
                    style: AppText.caption,
                  ),
                if (ready.isEmpty && _photos.isEmpty)
                  Text(
                    'Pick a photo to start real AI analysis.',
                    style: AppText.caption,
                  ),
                const SizedBox(height: Insets.xxl),
                SwButton(
                  label: _saving
                      ? 'Saving…'
                      : ready.length > 1
                          ? 'Save ${ready.length} to Wardrobe'
                          : 'Save to Wardrobe',
                  onTap: ready.isEmpty || _busy || _saving ? null : _save,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Tappable capture method row.
class _SourceTile extends StatelessWidget {
  const _SourceTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final SwIcon icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      onTap: onTap,
      padding: const EdgeInsets.all(Insets.lg),
      child: Row(
        children: [
          SwIconBadge(icon: icon, size: 44, iconSize: 20),
          const SizedBox(width: Insets.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppText.cardTitle),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.caption,
                ),
              ],
            ),
          ),
          const SwIconView(
            SwIcon.chevronRight,
            size: 16,
            color: AppColors.textTertiary,
          ),
        ],
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final offline = message.contains('unreachable') ||
        message.contains('Backend offline') ||
        message.contains('timed out');
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: Insets.lg),
      padding: const EdgeInsets.all(Insets.md),
      decoration: BoxDecoration(
        color: AppColors.dangerSurface,
        borderRadius: BorderRadius.circular(Radii.md),
      ),
      child: Text(
        offline
            ? 'Backend unreachable — run `npm start` in backend/ (or set API_BASE_URL to your PC’s LAN IP when testing from a phone), then retry.'
            : message,
        style: AppText.caption,
      ),
    );
  }
}

/// Live status line: analyzing / saving progress across picked photos.
class _StatusLine extends StatelessWidget {
  const _StatusLine({required this.photos});

  final List<_Staged> photos;

  @override
  Widget build(BuildContext context) {
    Widget leading;
    String text;
    final staging =
        photos.where((p) => p.phase == _Phase.staging).length;
    final saving = photos.where((p) => p.phase == _Phase.saving).length;
    final errors = photos.where((p) => p.phase == _Phase.error).length;
    final ready = photos.where((p) => p.phase == _Phase.ready).length;
    if (staging > 0) {
      leading = const SizedBox.square(
        dimension: 20,
        child: CircularProgressIndicator(strokeWidth: 2),
      );
      text = 'AI is analyzing your clothing'
          '${photos.length > 1 ? ' ($ready/${photos.length})' : ''}…';
    } else if (saving > 0) {
      leading = const SizedBox.square(
        dimension: 20,
        child: CircularProgressIndicator(strokeWidth: 2),
      );
      text = 'Saving to your wardrobe…';
    } else if (errors > 0 && ready == 0) {
      leading = const SwIconView(
        SwIcon.refresh,
        size: 20,
        color: AppColors.danger,
      );
      String? firstError;
      for (final p in photos) {
        if (p.phase == _Phase.error && (p.error?.isNotEmpty ?? false)) {
          firstError = p.error;
          break;
        }
      }
      text = firstError ?? 'Analysis failed — tap a photo to retry.';
    } else if (ready > 0) {
      final vision =
          photos.any((p) => p.phase == _Phase.ready && p.source != 'heuristic');
      leading = const SwIconView(
        SwIcon.check,
        size: 20,
        color: AppColors.success,
      );
      text = vision
          ? 'AI vision analysis complete — review the tags.'
          : 'Analysis complete (offline heuristics) — review the tags.';
      if (errors > 0) {
        text += ' $errors photo${errors == 1 ? '' : 's'} rejected.';
      }
    } else {
      return const SizedBox.shrink();
    }
    return Row(
      children: [
        leading,
        const SizedBox(width: Insets.md),
        Expanded(
          child: Text(
            text,
            style: AppText.bodyStrong.copyWith(fontSize: 13),
          ),
        ),
      ],
    );
  }
}

/// Thumbnails of picked photos with per-photo state + retry/remove.
class _PreviewGrid extends StatelessWidget {
  const _PreviewGrid({
    required this.photos,
    required this.onRemove,
    required this.onRetry,
  });

  final List<_Staged> photos;
  final void Function(int index) onRemove;
  final void Function(int index) onRetry;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        mainAxisSpacing: Insets.sm,
        crossAxisSpacing: Insets.sm,
      ),
      itemCount: photos.length,
      itemBuilder: (context, i) {
        final p = photos[i];
        return Stack(
          fit: StackFit.expand,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(Radii.md),
              child: p.bytes.isEmpty
                  ? const ColoredBox(color: AppColors.tint)
                  : Image.memory(p.bytes, fit: BoxFit.cover),
            ),
            if (p.phase == _Phase.staging || p.phase == _Phase.saving)
              Container(
                decoration: BoxDecoration(
                  color: AppColors.scrim,
                  borderRadius: BorderRadius.circular(Radii.md),
                ),
                child: const Center(
                  child: SizedBox.square(
                    dimension: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              ),
            if (p.phase == _Phase.ready)
              Positioned(
                left: 6,
                bottom: 6,
                right: 6,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.scrim,
                    borderRadius: BorderRadius.circular(Radii.sm),
                  ),
                  child: Text(
                    '${_tagValue(p.analysis, 'COLOR')} ${_tagValue(p.analysis, 'CATEGORY')}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.overline.copyWith(
                      fontSize: 9,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            if (p.phase == _Phase.error)
              Positioned.fill(
                child: GestureDetector(
                  onTap: () => onRetry(i),
                  child: Container(
                    decoration: BoxDecoration(
                      color: AppColors.scrim,
                      borderRadius: BorderRadius.circular(Radii.md),
                    ),
                    child: const Center(
                      child: SwIconView(
                        SwIcon.refresh,
                        size: 22,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
              ),
            Positioned(
              top: 2,
              right: 2,
              child: GestureDetector(
                onTap: () => onRemove(i),
                child: Container(
                  padding: const EdgeInsets.all(4),
                  decoration: const BoxDecoration(
                    color: AppColors.scrim,
                    shape: BoxShape.circle,
                  ),
                  child: const SwIconView(
                    SwIcon.close,
                    size: 12,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

/// The editable AI attribute grid backed by one photo's real analysis.
class _TagGrid extends StatelessWidget {
  const _TagGrid({required this.photo, required this.onChanged});

  final _Staged photo;
  final void Function(String label, String value) onChanged;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const gap = Insets.md;
        final width = (constraints.maxWidth - gap) / 2;

        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [
            for (final label in _tagFields.keys)
              SizedBox(
                width: width,
                child: _TagCell(
                  label: label,
                  value: _tagValue(photo.analysis, label),
                  onSaved: (v) => onChanged(label, v),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _TagCell extends StatelessWidget {
  const _TagCell({
    required this.label,
    required this.value,
    required this.onSaved,
  });

  final String label;
  final String value;
  final ValueChanged<String> onSaved;

  @override
  Widget build(BuildContext context) {
    return SwCard(
      padding: const EdgeInsets.all(Insets.md),
      onTap: () => _editTag(context),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: AppText.overline.copyWith(fontSize: 9)),
                const SizedBox(height: 3),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.bodyStrong.copyWith(fontSize: 13),
                ),
              ],
            ),
          ),
          const SwIconView(
            SwIcon.edit,
            size: 14,
            color: AppColors.textTertiary,
          ),
        ],
      ),
    );
  }

  void _editTag(BuildContext context) {
    final controller = TextEditingController(text: value);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      builder: (sheetContext) => Padding(
        padding: EdgeInsets.only(
          left: Insets.xl,
          right: Insets.xl,
          top: Insets.xl,
          bottom: MediaQuery.of(sheetContext).viewInsets.bottom + Insets.xl,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(label, style: AppText.h4),
            const SizedBox(height: Insets.lg),
            SwField(label: 'Value', controller: controller),
            const SizedBox(height: Insets.xl),
            SwButton(
              label: 'Save',
              onTap: () {
                onSaved(controller.text.trim());
                Navigator.of(sheetContext).pop();
              },
            ),
          ],
        ),
      ),
    );
  }
}
