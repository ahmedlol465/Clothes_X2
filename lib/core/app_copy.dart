/// Static UI copy that is not tied to a user or database row.
abstract final class AppCopy {
  static const List<String> stylistSuggestions = [
    'Outfit for University',
    'Date Outfit',
    'Formal Option',
  ];

  static String stylistGreeting(String? firstName) =>
      'Hi ${firstName?.trim().isNotEmpty == true ? firstName!.trim() : 'there'}! '
      'How can I help you today?';

  static const String emptyWardrobe =
      'Your wardrobe is empty. Add a garment to get started.';
  static const String emptyOutfits =
      'No saved outfits yet. Generate one from your wardrobe.';
  static const String emptyPlan = 'No weekly plan yet. Generate one from Planner.';
}
