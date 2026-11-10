# Personal Work Hub

[English](README.md) | **Türkçe**

Boards menüsüne **My Work** sayfasını ekleyen bir Azure DevOps extension'ı. Collection'daki bütün
projelerden work item'larınızı, pull request'lerinizi ve pipeline çalıştırmalarınızı tek sayfada
gösterir. Yalnızca veri okur.

Azure DevOps Server 2022 için geliştirildi ve orada denendi. Azure DevOps Services desteklenmez.

## Özellikler

Sayfada üç ana başlık, her başlığın altında iki liste vardır.

**Work Item'lar**

- Bana atananlar ve Açtıklarım
- Kapalı, tamamlanmış ve iptal edilmiş work item'lar varsayılan olarak gizlidir; bir kutucukla
  listeye eklenir
- Durum rozetleri renklidir: tamamlanan ve kapalı olanlar yeşil, iptal olanlar kırmızı, diğerleri nötr

**Pull Request'ler**

- Açtıklarım: aktif pull request'leriniz
- Review'ına atandıklarım: doğrudan ya da üyesi olduğunuz bir takım veya grup üzerinden reviewer
  olduğunuz pull request'ler; onayladıklarınız dahil
- Review listesi pull request'in size nasıl geldiğini (doğrudan ya da grup adı) ve oyunuzu
  gösterir. Siz oy vermediyseniz ama grubunuz adına başka bir üye oy verdiyse grubun oyu görünür
- Bir kutucuk, tamamlanan pull request'leri iki listeye de ekler

**Pipeline'lar**

- Build: sizin için çalışan son 50 build (`requestedFor`); push'unuzla tetiklenen CI build'leri de
  buna dahildir
- Release: oluşturduğunuz son 50 release, her aşama için bir rozetle

**Her listede**

- Görünen bütün sütunlarda arama
- Listedeki değerlerden üretilen açılır filtreler (tür, durum, proje, repo, açan, oy, pipeline,
  durum)
- Satırlar work item'a, pull request'e ya da çalıştırmaya bağlantı verir
- 5 dakikada bir yenilenir; Yenile düğmesi vardır
- Türkçe ve İngilizce arayüz

## Kurulum

Paketi üretin (aşağıya bakın), sonra sunucuda: Collection Settings → Extensions → Browse local
extensions → Manage extensions → Upload extension ile yükleyin ve collection'a kurun. Sayfa her
projede **Boards → My Work** altında görünür; hangi projeden açarsanız açın içerik aynıdır.

## İzinler

| Kapsam | Ne için |
| --- | --- |
| `vso.work` | Work item sorgularını çalıştırmak ve alanlarını okumak |
| `vso.code` | Pull request'leri okumak |
| `vso.build` | Build'leri okumak |
| `vso.release` | Release'leri okumak |
| `vso.project` | Projeleri ve üyesi olduğunuz takımları listelemek |
| `vso.identity` | Grup üyeliklerinizi okumak |

## Güvenlik

- **Salt okunur.** Extension yalnızca veri okur. Yaptığı iki `POST` isteği (`wit/wiql` ve
  `wit/workitemsbatch`) sorgudur; hiçbir şey oluşturulmaz, değiştirilmez ya da silinmez.
- **Kullanıcının kendi yetkileri geçerlidir.** Her istek oturum açmış kullanıcı adına yapılır;
  neyi görebileceğine sunucu karar verir. Erişim token'ı yalnızca collection adresine gönderilir,
  saklanmaz ve loglanmaz.
- **Bağlantılar.** Yalnızca `http` ve `https` adresleri bağlantı olarak gösterilir.
- **Tanılama.** Sayfanın altındaki kapalı Tanılama bölümü yalnızca sayıları ve hata mesajlarını
  içerir; başlık ya da kişi adı içermez.

## İşlerinizi nasıl bulur

| Liste | Kaynak |
| --- | --- |
| Work Item'lar → Bana atananlar | WIQL `[System.AssignedTo] = @Me` |
| Work Item'lar → Açtıklarım | WIQL `[System.CreatedBy] = @Me` |
| Pull Request'ler → Açtıklarım | `git/pullrequests?searchCriteria.creatorId` |
| Pull Request'ler → Review'ına atandıklarım | Sizin için `searchCriteria.reviewerId`, ayrıca aktif pull request'lerin taranıp reviewer'larının takım ve gruplarınızla karşılaştırılması |
| Pipeline'lar → Build | `build/builds?requestedFor`, proje proje |
| Pipeline'lar → Release | `release/releases?createdBy`, önce collection düzeyinde, sonra proje proje |

Takımlarınız `teams?$mine=true`, gruplarınız `identities?queryMembership` ile okunur. Bir kullanıcı
yüzlerce grubun üyesi olabildiği için grup atamaları grup başına sorguyla değil, aktif pull
request'lerin tek bir taramasıyla bulunur.

Azure DevOps Server 2022 build listesini proje olmadan reddeder (HTTP 400, VS800075); bu yüzden
build'ler her zaman proje proje sorulur.

## Bilinen sınırlar

- Liste başına en fazla 200 work item, 100 pull request ve 50 çalıştırma gösterilir. Liste sınıra
  ulaşınca sayfada bir not çıkar.
- Aktif pull request taraması 5.000 kayıtta durur.
- Review listesindeki tamamlanan pull request'ler yalnızca bizzat reviewer olduklarınızdır.
- Kapalı sayılan durumlar `src/hub/logic.ts` içindeki sabit `CLOSED_STATES` listesidir. Başka adlı
  özel bir durum açık sayılır; listeye ve renk için `stateTone` fonksiyonuna eklenmelidir.
- Filtreler yüklenmiş satırlar üzerinde çalışır. Kapalı durumlar Durum filtresinde ancak kutucuk
  işaretlendikten sonra görünür.
- Sayfa tarayıcı dilini izler; Server 2022 profil dilini extension'lara vermez. Menü girişi her
  zaman "My Work" olarak görünür.

## Geliştirme

```bash
npm install
```

```bash
npm run dev
```

Sayfa `http://localhost:3001/hub/hub.html` adresinde, `src/hub/mock.ts` içindeki örnek veriyle
açılır. Azure DevOps dışında SDK kullanılmaz; gerçek veri ancak extension kurulduktan sonra
görünür. Dili seçmek için adrese `?lang=tr` ya da `?lang=en` ekleyin.

```bash
npm test
```

```bash
npm run package
```

Paket `out/` altına yazılır. Her yüklemeden önce hem `vss-extension.json` hem `package.json`
içindeki `version` artırılmalıdır; sunucu, elinde olan bir sürümü yeniden kabul etmez.

Marketplace'e yayınlamak için (`turanemin` yayıncısına ait kişisel erişim token'ı gerekir):

```bash
npm run publish:marketplace -- --token <PAT>
```

### Yapı

| Dosya | İçerik |
| --- | --- |
| `vss-extension.json` | Manifest: hub tanımı, izinler |
| `overview.md` | Marketplace sayfası |
| `src/hub/hub.tsx` | Arayüz ve SDK başlatma |
| `src/hub/api.ts` | REST çağrıları (`api-version=7.0`) |
| `src/hub/logic.ts` | Sorgular, dönüşümler ve kurallar (saf fonksiyonlar, testli) |
| `src/hub/i18n.ts` | Türkçe ve İngilizce metinler, dil seçimi |
| `src/hub/mock.ts` | Geliştirme için örnek veri |
| `tests/logic.test.ts` | Birim testleri; REST kaynağı sahte bir sunucuya karşı da denenir |

## Lisans

MIT. Geliştiren: Emin Turan.
