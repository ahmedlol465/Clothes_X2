import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api/api_client.dart';
import '../../core/icons/sw_icon.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/sw_screen.dart';
import '../../core/widgets/sw_widgets.dart';
import '../../data/app_state.dart';
import '../../data/controllers/wardrobe_controller.dart';
import 'add_clothing_shared.dart';
import 'widgets.dart';

/// Frame 9 — real Add Clothes flow (spec §4.4):
/// Take Photo / Gallery / Upload Multiple all pick real device photos,
/// each photo is uploaded (`POST /wardrobe/upload`) and analyzed on its
/// actual pixels (`POST /ai/analyze-clothing`, Gemini vision when a key is
/// configured, heuristics otherwise). Tags are editable before saving, and
/// saving persists the garment with its real photo URL (`POST
/// /wardrobe/items`). No demo data anywhere on this page.
class AddClothingScreen extends StatefulWidget {
  const AddClothingScreen._(this._wardrobeController);

  factory AddClothingScreen({
    Key? key,
    WardrobeController? wardrobeController,
  }) {
    return AddClothingScreen._(
      wardrobeController ?? AppState.instance.wardrobeController,
    );
  }

  final WardrobeController _wardrobeController;

  @override
  State<AddClothingScreen> createState() => _AddClothingScreenState();
}

class _AddClothingScreenState extends State<AddClothingScreen> {
  final ImagePicker _picker = ImagePicker();
  final List<Staged> _photos = [];
  bool _saving = false;
  String? _pageError;

  @override
  void initState() {
    super.initState();
  }

  bool get _busy => _photos.any((p) =>
      p.phase == Phase.staging ||
      p.phase == Phase.pending ||
      p.phase == Phase.saving);

  List<Staged> get _ready =>
      _photos.where((p) => p.phase == Phase.ready).toList();

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
        _photos.add(Staged(
          filename: f.name.isNotEmpty ? f.name : 'photo.jpg',
          bytes: Uint8List(0),
          mimeType: guessMime(f.name),
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
          _photos[i].phase = Phase.error;
          _photos[i].error = 'Could not read this file.';
        });
        continue;
      }
      _photos[i] = Staged(
        filename: _photos[i].filename,
        bytes: bytes,
        mimeType: _photos[i].mimeType,
      );
      await _stage(i);
    }
  }

  Future<void> _stage(int index) async {
    final photo = _photos[index];
    setState(() {
      photo.phase = Phase.staging;
      photo.error = null;
    });
    try {
      final staged = await widget._wardrobeController.stagePhoto(
        filename: photo.filename,
        bytes: photo.bytes,
        mimeType: photo.mimeType,
      );
      if (!mounted) return;
      setState(() {
        photo.phase = Phase.ready;
        photo.url = staged.url;
        photo.analysis = staged.analysis;
        photo.source = staged.source;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        photo.phase = Phase.error;
        photo.error = e.message;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        photo.phase = Phase.error;
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
        p.phase = Phase.saving;
      }
    });
    var saved = 0;
    String? firstError;
    for (final p in ready) {
      try {
        await widget._wardrobeController.addItem({
          'name':
              '${p.analysis['suggestedName'] ?? p.filename.split('.').first}',
          'image': p.url,
          'category': tagValue(p.analysis, 'CATEGORY'),
          'color': tagValue(p.analysis, 'COLOR'),
          'style': tagValue(p.analysis, 'STYLE'),
          'pattern': tagValue(p.analysis, 'PATTERN'),
          'material': tagValue(p.analysis, 'MATERIAL'),
          'season': tagValue(p.analysis, 'SEASON'),
          'formality': tagValue(p.analysis, 'FORMALITY'),
          'analysisSource': p.source,
        });
        p.phase = Phase.done;
        saved++;
      } on ApiException catch (e) {
        p.phase = Phase.error;
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
    _photos.removeWhere((p) => p.phase == Phase.done);
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
                SourceTile(
                  icon: SwIcon.camera,
                  title: 'Take Photo',
                  subtitle: 'Instantly capture and auto-tag a piece',
                  onTap: _busy || _saving ? null : _takePhoto,
                ),
                const SizedBox(height: Insets.md),
                SourceTile(
                  icon: SwIcon.image,
                  title: 'Choose from Gallery',
                  subtitle: 'Select existing clothing images',
                  onTap: _busy || _saving ? null : _fromGallery,
                ),
                const SizedBox(height: Insets.md),
                SourceTile(
                  icon: SwIcon.upload,
                  title: 'Upload Multiple',
                  subtitle: 'Bulk import your wardrobe catalog',
                  onTap: _busy || _saving ? null : _uploadMultiple,
                ),
                const SizedBox(height: Insets.xl),
                if (_pageError != null) ErrorBanner(message: _pageError!),
                if (_photos.isNotEmpty) ...[
                  PreviewGrid(
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
                StatusLine(photos: _photos),
                const SizedBox(height: Insets.lg),
                // Single analyzed photo → real editable tags.
                if (ready.length == 1)
                  TagGrid(
                    photo: ready.first,
                    onChanged: (label, value) => setState(() {
                      ready.first.analysis[tagFields[label]!] = value;
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