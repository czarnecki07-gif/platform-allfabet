# Platform — starter

## 1. Instalacja
```bash
npm install
```

## 2. Utwórz bazę PostgreSQL
Przykład:
```sql
CREATE DATABASE course_platform;
```

## 3. Skopiuj env
Skopiuj `.env.example` do `.env` i wpisz własne dane.

## 4. Wgraj schemat bazy
```bash
psql -U postgres -d course_platform -f schema.sql
```

## 5. Uruchom
```bash
npm run dev
```

## 6. Test
- health:
```txt
GET http://localhost:4000/api/health
```
- lista kursów:
```txt
GET http://localhost:4000/api/courses
```

## 7. Import kursu
Wyślij `POST /api/courses/import` z JSON-em:
```json
{
  "project": { ...cały projekt z generatora... },
  "status": "draft"
}
```
