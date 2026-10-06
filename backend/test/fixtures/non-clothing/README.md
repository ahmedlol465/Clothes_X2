# Non-clothing test fixtures

Photos of objects that must never be accepted as a garment. `npm run
vision:selftest` runs the real pipeline over these together with
`assets/images` and exits non-zero if any of them is accepted.

| file       | what it is                    | source |
|------------|-------------------------------|--------|
| bottle.jpg | glass water bottle            | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Acqua_Panna_mineral_water_in_a_glass_bottle_-_20140408.jpg) |
| phone.jpg  | smartphone                    | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:IPhone_13_Pro_vector.svg) |
| laptop.jpg | laptop on a desk              | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Laptop_on_a_desk_(Unsplash).jpg) |
| chair.jpg  | upholstered desk chair        | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Desk_chair_(fauteuil_de_bureau)_MET_174288.jpg) |
| mug.jpg    | coffee mug                    | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Coffee_mug.jpg) |
| tv_remote.jpg | remote control             | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Remote_control.jpg) |

Each is a downscaled 640–960px Wikimedia thumbnail. Check the individual file
pages for exact licence terms before reusing them anywhere else.

`chair.jpg` is a painting of a chair rather than a photograph, which makes it the
hardest case in the set: an upholstered seat genuinely does look a lot like a
structured garment to a CLIP-style encoder.