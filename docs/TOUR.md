# A tour of Memento

This is what Memento looks like before you install it. Every screenshot is the real app, running with the demo family (the Riveras) that a fresh install starts with, plus some photos.

- [The shelf](#the-shelf)
- [Reading a book](#reading-a-book)
- [Editing a book](#editing-a-book)
- [Editor's Desk](#editors-desk)
- [Dark mode](#dark-mode)
- [On a phone](#on-a-phone)
- [Signing in](#signing-in)

## The shelf

Each household gets a book on a wooden shelf. Choose a spine to take the book off the shelf and open it. You can change the cover colour, texture and size of each book, and the words above the shelf.

![The library shelf with five family books](screenshots/shelf.jpg)

## Reading a book

A book opens with a cover animation and turns its pages in 3D. Swipe, tap a corner, or use the arrow keys. The tabs on the right go straight to the contents, a year or a month.

![A book cover swinging open](screenshots/cover.jpg)

The title page has the book's name, the year and a photo.

![The title page with a sunset photo](screenshots/title.jpg)

The contents list every year in the book and the month chapters in the latest year.

![The contents and chapters pages](screenshots/contents.jpg)

Each year starts with a summary spread: one photo for each month, and three more for whatever didn't fit a month. Every photo has a short caption in handwriting. You can write captions yourself, or let an AI model draft them.

![A year in photos, one for each month](screenshots/year.jpg)

A month chapter holds up to 14 photos, with a subtitle, a note and a short journal entry.

![The July chapter, a week at the lake](screenshots/month.jpg)

Tap a photo to see it large. Use the arrows to step through every photo on the spread.

![A photo opened large, with its caption](screenshots/lightbox.jpg)

## Editing a book

Anyone in the family can read every book. To change one, they need its 4-digit PIN. The admin sets the PINs and can edit without one.

![The PIN prompt before editing a locked book](screenshots/pin.jpg)

In edit mode, a panel opens beside the book. Add years and month chapters, write headers and journal entries, and pick a page theme and stickers. Add photos to the open spread from the panel, then drag them to rearrange.

![Edit mode with the book editor panel](screenshots/edit.jpg)

## Editor's Desk

The admin runs the library from Editor's Desk.

**Family members.** Invite people by email, put them in households, and choose who can manage their own household. New people can ask to join from the sign-in page, and their requests wait here for approval.

![Family members, with one request to join](screenshots/desk-family.jpg)

**Books.** Each book's cover, size, shelf order and PIN.

![Books, with cover and lock settings](screenshots/desk-books.jpg)

**Photo inbox.** Drop in a pile of photos (or share them from your phone's share sheet), let the AI draft captions, then file each one into a book and chapter.

![The photo inbox with three photos to file](screenshots/desk-inbox.jpg)

**AI captions.** Connect any OpenAI-compatible endpoint (OpenAI, a local model, and so on) and tune the prompts and voice. Test a caption before you use it. The key is stored encrypted and never reaches the browser. AI is optional: you can write every caption yourself.

![AI caption settings with a test caption](screenshots/desk-ai.jpg)

**Theme library.** Page backgrounds and motifs for chapters: plain, kraft paper, holidays, birthdays and more.

![Theme library with eight page themes](screenshots/desk-themes.jpg)

**Settings.** Family name, the words on the landing page, and whether new books start locked.

![Settings](screenshots/desk-settings.jpg)

## Dark mode

Dark mode dims the room but leaves the pages as paper.

![The shelf in dark mode](screenshots/dark-shelf.jpg)

![A year spread in dark mode](screenshots/dark-year.jpg)

## On a phone

On a phone, Memento shows one page at a time. You can install it on your home screen as an app, and it keeps the last books you opened for reading offline.

<p>
  <img src="screenshots/phone-shelf.jpg" alt="The shelf on a phone" width="260">
  <img src="screenshots/phone-title.jpg" alt="A title page on a phone" width="260">
  <img src="screenshots/phone-year.jpg" alt="A year page on a phone" width="260">
</p>

## Signing in

There are no passwords. People sign in with a link or a 6-digit code sent to their email.

![The sign-in screen](screenshots/login.jpg)

## Try it yourself

The [README](../README.md) shows how to run Memento with Docker, your own Postgres and an S3-compatible store such as MinIO.

---

The demo photos come from [Unsplash](https://unsplash.com) via [Lorem Picsum](https://picsum.photos) and are used under the [Unsplash License](https://unsplash.com/license). The photographers are Alexander Shustov, Angelina Odemchuk, Anton Sulsky, Ben Moore, Beto Galetto, Caroline Sada, Charlie Foster, Christopher Sardegna, Danka & Peter, Diogo Tavares, Elias Carlsson, Florian Klauer, Gozha Net, Ilham Rahmansyah, Isaak Dury, Jassy Onyae, Jon Eckert, Kenneth Thewissen, Linh Nguyen, Matteo Minelli, Matthew Skinner, May Pamintuan, Nicholas Swanson, Noel Lopez, Paul Jarvis, Philipp Reiner, Rafael Souza, Rula Sibai, Shyamanta Baruah, Wojtek Witkowski, müllermarc and petradr.
