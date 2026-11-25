import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'features/auth/login_screen.dart';
import 'features/onboarding/onboarding_screen.dart';
import 'features/onboarding/body_profile_screen.dart';
import 'features/shell/main_shell.dart';
import 'features/splash/splash_screen.dart';
import 'features/wardrobe/add_clothing_screen.dart';
import 'features/wardrobe/item_detail_screen.dart';
import 'features/wardrobe/analyzing_screen.dart';
import 'features/outfits/outfit_planner_screen.dart';
import 'features/outfits/perfect_match_screen.dart';
import 'features/outfits/outfit_history_screen.dart';
import 'features/travel/travel_planner_screen.dart';
import 'features/insights/wardrobe_insights_screen.dart';
import 'features/insights/style_dna_screen.dart';
import 'features/profile/style_profile_screen.dart';
import 'features/profile/coming_soon_screen.dart';
import 'features/shop/smart_shopping_screen.dart';
import 'features/stylist/stylist_screen.dart';
import 'features/stylist/stylist_desk_screen.dart' as desk;
import 'features/stylist/create_outfit_screen.dart';
import 'features/stylist/style_avatar_screen.dart';
import 'features/discover/discover_screen.dart';
import 'features/outfit_studio/outfit_studio_screen.dart';

import 'core/theme/app_colors.dart';
import 'core/theme/app_theme.dart';
import 'data/assets.dart';
import 'data/models.dart';
import 'core/icons/sw_icon.dart';

/// Named routes for every screen in the app.
abstract final class Routes {
  static const String splash = '/';
  static const String onboarding = '/onboarding';
  static const String bodyProfile = '/body-profile';
  static const String login = '/login';
  static const String signUp = '/signup';
  static const String shell = '/shell';
  static const String addClothing = '/add-clothing';
  static const String itemDetail = '/item-detail';
  static const String analyzing = '/analyzing';
  static const String styleProfile = '/style-profile';
  static const String comingSoon = '/coming-soon';
  static const String styleDna = '/style-dna';
  static const String wardrobeInsights = '/wardrobe-insights';
  static const String smartShopping = '/smart-shopping';
  static const String discover = '/discover';
  static const String perfectMatch = '/perfect-match';
  static const String travelPlanner = '/travel-planner';
  static const String outfitPlanner = '/outfit-planner';
  static const String outfitHistory = '/outfit-history';
  static const String createOutfit = '/create-outfit';
  static const String stylist = '/stylist';
  static const String stylistClassic = '/stylist-classic';
  static const String styleAvatar = '/style-avatar';
  static const String outfitStudio = '/outfit-studio';
}


/// Route table shared by the root [MaterialApp] and the per-tab navigators in
/// MainShell, so both resolve the same pages for the same route names.
final Map<String, WidgetBuilder> appRouteTable = {
  Routes.splash: (_) => SplashScreen(),
  Routes.onboarding: (_) => const OnboardingScreen(),
  Routes.bodyProfile: (_) => BodyProfileScreen(),
  Routes.login: (_) => LoginScreen(),
  Routes.signUp: (_) => SignUpScreen(),
  Routes.shell: (_) => MainShell(),
  Routes.addClothing: (_) => AddClothingScreen(),
  Routes.styleProfile: (_) => StyleProfileScreen(),
  Routes.styleDna: (_) => const StyleDnaScreen(),
  Routes.wardrobeInsights: (_) => WardrobeInsightsScreen(),
  Routes.smartShopping: (_) => SmartShoppingScreen(),
  Routes.discover: (_) => const DiscoverScreen(),
  Routes.travelPlanner: (_) => TravelPlannerScreen(),
  Routes.outfitPlanner: (_) => OutfitPlannerScreen(),
  Routes.outfitHistory: (_) => const OutfitHistoryScreen(),
  Routes.createOutfit: (_) => const CreateOutfitScreen(),
  Routes.stylist: (_) => const desk.StylistDeskScreen(),
  Routes.stylistClassic: (_) => StylistScreen(),
  Routes.styleAvatar: (_) => const StyleAvatarScreen(),
  Routes.outfitStudio: (_) => OutfitStudioScreen(),
};

/// Resolves a named route to its page, including routes that carry arguments.
/// Returns null when the name is unknown so callers can fall back.
Route<dynamic>? resolveAppRoute(RouteSettings settings) {
  final builder = appRouteTable[settings.name];
  if (builder != null) {
    return MaterialPageRoute(settings: settings, builder: builder);
  }
  switch (settings.name) {
    case Routes.itemDetail:
      final args = settings.arguments as ClothingItem?;
      if (args == null) return null;
      return MaterialPageRoute(
        settings: settings,
        builder: (_) => ItemDetailScreen(item: args),
      );
    case Routes.analyzing:
      final args = settings.arguments as Map<String, dynamic>?;
      return MaterialPageRoute(
        settings: settings,
        builder: (_) => AnalyzingScreen(
          name: args?['name'] as String? ?? 'New Garment',
          filename: args?['filename'] as String? ?? 'upload.jpg',
          image: args?['image'] as String? ?? Img.teeWhite,
        ),
      );
    case Routes.comingSoon:
      final args = settings.arguments as Map<String, dynamic>?;
      if (args == null) return null;
      return MaterialPageRoute(
        settings: settings,
        builder: (_) => ComingSoonScreen(
          title: args['title'] as String? ?? 'Coming Soon',
          subtitle: args['subtitle'] as String? ?? '',
          icon: args['icon'] as SwIcon? ?? SwIcon.sparkle,
        ),
      );
    case Routes.perfectMatch:
      final args = settings.arguments as Outfit?;
      return MaterialPageRoute(
        settings: settings,
        builder: (_) => PerfectMatchScreen(outfit: args),
      );
    default:
      return null;
  }
}

class SmartWardrobeApp extends StatelessWidget {
  const SmartWardrobeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SmartWardrobe',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.build(),
      initialRoute: Routes.splash,
routes: appRouteTable,
      onGenerateRoute: (settings) => resolveAppRoute(settings) ?? _errorRoute(),
      builder: (context, child) {
        return AnnotatedRegion<SystemUiOverlayStyle>(
          value: const SystemUiOverlayStyle(
            statusBarColor: Colors.transparent,
            statusBarIconBrightness: Brightness.dark,
            statusBarBrightness: Brightness.light,
            systemNavigationBarColor: AppColors.background,
            systemNavigationBarIconBrightness: Brightness.dark,
          ),
          child: child ?? const SizedBox.shrink(),
        );
      },
    );
  }

  static Route<dynamic> _errorRoute() => MaterialPageRoute(
        builder: (_) => const Scaffold(
          body: Center(child: Text('Route not found')),
        ),
      );
}
