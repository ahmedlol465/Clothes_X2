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
    var declined = 0;
    String? firstError;
    for (final p in ready) {
      final payload = <String, dynamic>{
        'name': '${p.analysis['suggestedName'] ?? p.filename.split('.').first}',
        'image': p.url,
        'category': tagValue(p.analysis, 'CATEGORY'),
        'color': tagValue(p.analysis, 'COLOR'),
        'style': tagValue(p.analysis, 'STYLE'),
        'pattern': tagValue(p.analysis, 'PATTERN'),
        'material': tagValue(p.analysis, 'MATERIAL'),
        'season': tagValue(p.analysis, 'SEASON'),
        'formality': tagValue(p.analysis, 'FORMALITY'),
        if (p.analysis['gender'] is String) 'gender': p.analysis['gender'],
        'analysisSource': p.source,
      };
      // An item labelled for the other gender than the profile asks first.
      // Same gender, Unisex or unknown are added without asking.
      final itemGender = '${p.analysis['gender'] ?? ''}'.toLowerCase();
      final myGender =
          (AppState.instance.accountController.profile?.gender ?? '').toLowerCase();
      if ((itemGender == 'male' || itemGender == 'female') &&
          (myGender == 'male' || myGender == 'female') &&
          itemGender != myGender &&
          mounted) {
        final add = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Different gender'),
            content: Text(
              '"${payload['name']}" looks like a ${itemGender == 'male' ? "men's" : "women's"} item. Add it?',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(false),
                child: const Text('No'),
              ),
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(true),
                child: const Text('Yes'),
              ),
            ],
          ),
        );
        if (add != true) {
          p.phase = Phase.ready;
          declined++;
          continue;
        }
      }
      try {
        await widget._wardrobeController.addItem(payload);
        p.phase = Phase.done;
        saved++;
      } on ApiException catch (e) {
        // 409 = the same piece is already in the wardrobe. Tell the user and
        // offer "Add anyway" instead of failing silently.
        if (e.status == 409 && mounted) {
          final addAnyway = await showDialog<bool>(
            context: context,
            builder: (ctx) => AlertDialog(
              title: const Text('Already in your wardrobe'),
              content: Text(
                '"${payload['name']}" looks like a piece you already have.',
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(ctx).pop(false),
                  child: const Text('Skip'),
                ),
                TextButton(
                  onPressed: () => Navigator.of(ctx).pop(true),
                  child: const Text('Add anyway'),
                ),
              ],
            ),
          );
          if (addAnyway == true) {
            try {
              await widget._wardrobeController
                  .addItem({...payload, 'allowDuplicate': true});
              p.phase = Phase.done;
              saved++;
              continue;
            } on ApiException catch (e2) {
              p.phase = Phase.error;
              p.error = e2.message;
              firstError ??= e2.message;
              continue;
            }
          }
          p.phase = Phase.error;
          p.error = 'Already in your wardrobe.';
          firstError ??= 'Already in your wardrobe.';
          continue;
        }
        p.phase = Phase.error;
        p.error = e.message;
        firstError ??= e.message;
      }
    }
    if (!mounted) return;
    setState(() => _saving = false);
    if (saved == 0 && declined > 0 && firstError == null) return;
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
                for (var n = 0; n < ready.length; n++)
                  if (_needsTypeConfirm(ready[n]))
                    _TypeConfirmCard(
                      number: ready.length > 1 ? n + 1 : null,
                      photo: ready[n],
                      onPick: (option) => setState(() => _applyType(ready[n], option)),
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

/// True when the photo's type guess was weak and the user has not confirmed it.
bool _needsTypeConfirm(Staged photo) {
  final check = photo.analysis['typeCheck'];
  if (check is! Map || check['needsConfirm'] != true) return false;
  final options = check['options'];
  return options is List && options.length > 1;
}

/// Applies the user's one-tap choice: category, one-piece flag and the
/// suggested name (colour + type), then clears the question.
void _applyType(Staged photo, Map option) {
  final sub = '${option['subcategory']}';
  final color = '${photo.analysis['color'] ?? ''}'.trim();
  photo.analysis['subcategory'] = sub;
  if (option['category'] is String) photo.analysis['category'] = option['category'];
  photo.analysis['isOnePiece'] = sub == 'Dress' || sub == 'Jumpsuit';
  photo.analysis['suggestedName'] = color.isEmpty ? sub : '$color $sub';
  final check = Map<String, dynamic>.from(photo.analysis['typeCheck'] as Map);
  check['needsConfirm'] = false;
  photo.analysis['typeCheck'] = check;
}

/// One-tap question shown under a photo whose garment type is uncertain.
class _TypeConfirmCard extends StatelessWidget {
  const _TypeConfirmCard({
    required this.photo,
    required this.onPick,
    this.number,
  });

  final Staged photo;
  final int? number;
  final void Function(Map option) onPick;

  @override
  Widget build(BuildContext context) {
    final options = (photo.analysis['typeCheck']['options'] as List)
        .whereType<Map>()
        .toList();
    final current = '${photo.analysis['subcategory'] ?? ''}';
    return Padding(
      padding: const EdgeInsets.only(top: Insets.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            number == null
                ? 'Not sure about this one. What is it?'
                : 'Photo $number: not sure about this one. What is it?',
            style: AppText.label,
          ),
          const SizedBox(height: Insets.sm),
          Wrap(
            spacing: Insets.sm,
            runSpacing: Insets.sm,
            children: [
              for (final option in options)
                SwChip(
                  label: '${option['subcategory']}',
                  selected: current == '${option['subcategory']}',
                  onTap: () => onPick(option),
                ),
            ],
          ),
          const SizedBox(height: Insets.xs),
          Text(
            'Another type? Change it in the tags above or edit it later.',
            style: AppText.caption,
          ),
        ],
      ),
    );
  }
}
