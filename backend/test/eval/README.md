# Vision evaluation set

`labels.csv` is the ground truth. One row per image. Run:

    npm run vision:eval

Columns: file,is_clothing,subcategory,gender,color,pattern
- file: path relative to this folder, or `asset:NAME.jpg` for ../../../assets/images, or `fixture:NAME.jpg` for test/fixtures/non-clothing
- is_clothing: yes / no
- subcategory: must match a name in src/clothing-vision/prompts.ts GARMENTS (T-Shirt, Jeans, Dress...). Blank = not scored.
- gender: Male / Female / Unisex. Blank = not scored.
- color, pattern: blank = not scored.

Rules for an honest number:
1. Label by looking at the photo, not by running the model first.
2. Keep photos the model was tuned on (the bundled assets) separate from new photos; the report prints both ("seen" = asset:/fixture:, "held-out" = everything else). Quote the held-out number.
3. Aim for 20+ images per class you want to claim. Small sets give wide error bars; the report prints the count next to every number.
The starter rows were labelled from file names only and have NOT been checked by a person. Verify them.
