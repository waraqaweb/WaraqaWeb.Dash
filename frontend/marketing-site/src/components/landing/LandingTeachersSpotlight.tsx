import type { LandingSection, MarketingTeacher } from '@/lib/marketingClient';
import Image from 'next/image';
import { SectionIntro } from './SectionIntro';
import { cardClasses, mutedTextClass, surfaceClasses } from './theme';

type Props = {
  section: LandingSection;
  teachers: MarketingTeacher[];
};

const formatName = (teacher: MarketingTeacher) => {
  if (teacher.firstName) {
    const lastInitial = teacher.lastName ? `${teacher.lastName.charAt(0).toUpperCase()}.` : '';
    return `${teacher.firstName} ${lastInitial}`.trim();
  }
  return teacher.name || 'Teacher';
};

const LandingTeachersSpotlight = ({ section, teachers }: Props) => {
  const limit = section.limit && section.limit > 0 ? section.limit : 4;
  const visibleTeachers = teachers.slice(0, limit);
  const themeSurface = surfaceClasses(section.theme);
  const mutedText = mutedTextClass(section.theme);

  return (
    <section className={`py-16 ${themeSurface}`}>
      <div className="mx-auto max-w-6xl px-4">
        <SectionIntro
          section={section}
          fallback={{
            kicker: 'Teachers',
            headline: 'Meet the instructors families talk about',
            subheading: 'Featured profiles sync directly from the Marketing Hub.'
          }}
          align="left"
        />

        {!visibleTeachers.length ? (
          <p className={`mt-10 rounded-2xl border border-dashed px-6 py-8 text-sm ${mutedText}`}>
            Publish a featured teacher to populate this block.
          </p>
        ) : (
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visibleTeachers.map((teacher) => (
              <article key={teacher._id} className={`rounded-2xl p-5 shadow-sm ${cardClasses(section.theme)}`}>
                <div className="flex items-center gap-4">
                  {teacher.avatar ? (
                    <Image
                      src={teacher.avatar}
                      alt={formatName(teacher)}
                      width={56}
                      height={56}
                      className="h-14 w-14 rounded-2xl object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-lg font-semibold text-slate-500">
                      {formatName(teacher).charAt(0)}
                    </div>
                  )}
                  <div>
                    <p className="text-base font-semibold">{formatName(teacher)}</p>
                    <p className={`text-sm ${mutedText}`}>{teacher.role || 'Instructor'}</p>
                  </div>
                </div>
                <p className={`mt-4 text-sm ${mutedText}`}>
                  {teacher.bio || 'Bio will appear as soon as marketing adds it.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
                  {(teacher.languages || []).slice(0, 3).map((language: string) => (
                    <span key={language} className="rounded-full bg-slate-100/70 px-2 py-0.5">
                      {language}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export { LandingTeachersSpotlight };
